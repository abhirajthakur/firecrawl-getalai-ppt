import FirecrawlApp, { type ScrapeResponse } from "@mendable/firecrawl-js";
import crypto from "crypto";
import { setTimeout } from "timers/promises";
import { WebSocket } from "ws";

type SlideOutline = Record<string, any>;

interface SlideData {
	id: string;
	slide_outline: {
		slide_id: string;
		slide_title: string;
		slide_context: string;
		slide_instructions: string;
		images_on_slide: Array<any> | null;
		[key: string]: any;
	};
	[key: string]: any;
}

const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY || "";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";

const API_BASE = "https://alai-standalone-backend.getalai.com";
const API = {
	createPresentation: `${API_BASE}/create-new-presentation`,
	getQuestions: (id: string) => `${API_BASE}/get-presentation-questions/${id}`,
	updateSlide: `${API_BASE}/update-slide-entity`,
	setActiveVariant: `${API_BASE}/set-active-variant`,
	sharePresentation: `${API_BASE}/upsert-presentation-share`,
	shareableLink: (id: string) => `https://app.getalai.com/view/${id}`,
};

const WS = {
	generateOutline: `wss://alai-standalone-backend.getalai.com/ws/generate-slides-outline`,
	createSlides: `wss://alai-standalone-backend.getalai.com/ws/create-slides-from-outlines`,
	createVariants: `wss://alai-standalone-backend.getalai.com/ws/create-and-stream-slide-variants`,
};

async function fetchApi<T>(
	endpoint: string,
	method = "GET",
	body?: any,
): Promise<T> {
	const timeoutId = setTimeout(15000);

	try {
		const response = await fetch(endpoint, {
			method,
			headers: {
				Authorization: `Bearer ${ACCESS_TOKEN}`,
			},
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!response.ok) {
			throw new Error(`API Error: ${await response.text()}`);
		}

		return (await response.json()) as T;
	} catch (err) {
		if (err instanceof Error) {
			console.error("Error while fetching: ", err.message);
		}
		throw err;
	} finally {
		clearTimeout(timeoutId as any);
	}
}

async function scrapeWebsite(url: string): Promise<ScrapeResponse> {
	const app = new FirecrawlApp({ apiKey: FIRECRAWL_KEY });

	console.log(`Scraping ${url}...`);

	const result = (await app.scrapeUrl(url, {
		formats: ["markdown"],
	})) as ScrapeResponse;

	if (!result.success) {
		throw new Error(result.error || "Unknown scraping error");
	}

	return result;
}

async function createPresentation() {
	const uuid = crypto.randomUUID();

	const payload = {
		presentation_id: uuid,
		presentation_title: "Website Presentation",
		create_first_slide: true,
		theme_id: "a6bff6e5-3afc-4336-830b-fbc710081012",
		default_color_set_id: 0,
	};

	console.log("Creating new presentation", uuid);
	const result = await fetchApi<{ id: string; slides: Array<{ id: string }> }>(
		API.createPresentation,
		"POST",
		payload,
	);

	return {
		presentationId: result.id,
		initialSlideId: result.slides[0]?.id,
	};
}

async function generateSlideOutlines(
	websiteData: ScrapeResponse,
	presentationId: string,
): Promise<SlideOutline[]> {
	console.log("Generating slide outlines...");

	const questions = await fetchApi<any>(API.getQuestions(presentationId));

	const rawContext = `markdown: ${websiteData.markdown?.substring(0, 50000)},
metadata: ${JSON.stringify(websiteData.metadata || {})}`;

	return new Promise((resolve, reject) => {
		const outlines: SlideOutline[] = [];
		const ws = new WebSocket(WS.generateOutline);

		ws.on("error", reject);

		ws.on("message", (data) => {
			try {
				const jsonData = JSON.parse(data.toString());
				if (jsonData && Object.keys(jsonData).length > 0) {
					outlines.push(jsonData);
				}
			} catch (err) {
				console.warn(`! Failed to parse outline data: ${err}`);
			}
		});

		ws.on("close", () => {
			if (outlines.length > 0) {
				resolve(outlines);
			} else {
				reject(new Error("No slide outlines were generated"));
			}
		});

		setTimeout(30000).then(() => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.close();
				if (outlines.length > 0) {
					console.error(
						`Outline generation timed out, but got ${outlines.length} outlines`,
					);
					resolve(outlines);
				} else {
					reject(new Error("Outline generation timed out with no results"));
				}
			}
		});

		ws.on("open", () => {
			const payload = {
				auth_token: ACCESS_TOKEN,
				presentation_id: presentationId,
				presentation_instructions: "",
				presentation_questions: questions,
				raw_context: rawContext,
				slide_order: 0,
				slide_range: "2-5",
			};

			ws.send(JSON.stringify(payload));
		});
	});
}

async function createSlidesFromOutlines(
	websiteData: ScrapeResponse,
	presentationId: string,
	initialSlideId: string,
	slidesOutlines: SlideOutline[],
): Promise<{ slides: SlideData[]; removeId?: string }> {
	console.log("Creating slides from outlines...");

	return new Promise((resolve, reject) => {
		const ws = new WebSocket(WS.createSlides);
		let slides: SlideData[] = [];
		let slideToRemove: string | undefined;
		let done = false;

		ws.on("error", (err) => {
			console.error(`Create slides error: ${err.message}`);
			reject(err);
		});

		ws.on("message", (data) => {
			try {
				const jsonData = JSON.parse(data.toString());

				if (jsonData.slide_id && !slideToRemove) {
					slideToRemove = jsonData.slide_id;
				}

				if (jsonData.slides && Array.isArray(jsonData.slides)) {
					slides = jsonData.slides;

					if (slides.length > 0 && !done) {
						done = true;
						ws.close();
					}
				}
			} catch (err) {
				console.warn(`!Error parsing slide data: ${err}`);
			}
		});

		ws.on("close", () => {
			if (slides.length > 0) {
				const filteredSlides = slides.filter(
					(s) => s.slide_outline?.slide_id !== slideToRemove,
				);

				console.log(`Created ${filteredSlides.length} slides successfully`);
				resolve({ slides: filteredSlides, removeId: slideToRemove });
			} else {
				reject(new Error("No slides were created"));
			}
		});

		setTimeout(45000).then(() => {
			if (ws.readyState === WebSocket.OPEN && !done) {
				done = true;
				ws.close();

				if (slides.length > 0) {
					const filteredSlides = slides.filter(
						(s) => s.slide_outline?.slide_id !== slideToRemove,
					);
					console.log(
						`!Create slides timed out, but got ${filteredSlides.length} slides`,
					);
					resolve({ slides: filteredSlides, removeId: slideToRemove });
				} else {
					reject(new Error("Create slides timed out with no results"));
				}
			}
		});

		ws.on("open", () => {
			const context = {
				title: websiteData.metadata?.title || "Website Content",
				url: websiteData.metadata?.url || "",
				excerpt: websiteData.markdown?.substring(0, 1000),
			};

			const payload = {
				auth_token: ACCESS_TOKEN,
				presentation_id: presentationId,
				presentation_instructions: "",
				raw_context: JSON.stringify(context),
				slide_id: initialSlideId,
				slide_outlines: slidesOutlines,
				starting_slide_order: 0,
				update_tone_verbosity_calibration_status: true,
			};

			ws.send(JSON.stringify(payload));
		});
	});
}

async function createSlideVariants(
	presentationId: string,
	slide: SlideData,
): Promise<string> {
	console.log(
		`Creating variants for slide: ${slide.slide_outline.slide_title}`,
	);

	return new Promise((resolve, reject) => {
		const ws = new WebSocket(WS.createVariants);
		let variantId = "";

		ws.on("error", reject);

		ws.on("message", (data) => {
			try {
				const jsonData = JSON.parse(data.toString());
				if (jsonData.slide_id && jsonData.id && !variantId) {
					variantId = jsonData.id;
					console.log("Got variant: ", variantId);
					ws.close();
				}
			} catch (err) {
				console.warn(`!Error parsing variant data: ${err}`);
			}
		});

		ws.on("close", () => {
			if (variantId) {
				resolve(variantId);
			} else {
				reject(new Error(`No variants created for slide ${slide.id}`));
			}
		});

		setTimeout(30000).then(() => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.close();
				if (variantId) {
					resolve(variantId);
				} else {
					reject(new Error(`Variant creation timed out for slide ${slide.id}`));
				}
			}
		});

		ws.on("open", () => {
			const payload = {
				additional_instructions: slide.slide_outline.slide_instructions || "",
				auth_token: ACCESS_TOKEN,
				images_on_slide: slide.slide_outline.images_on_slide || [],
				layout_type: "AI_GENERATED_LAYOUT", // My preferred layout type
				presentation_id: presentationId,
				slide_id: slide.slide_outline.slide_id,
				slide_specific_context: slide.slide_outline.slide_context || "",
				slide_title: slide.slide_outline.slide_title || "Untitled Slide",
				update_tone_verbosity_calibration_status: false,
			};

			ws.send(JSON.stringify(payload));
		});
	});
}

async function sharePresentation(presentationId: string): Promise<string> {
	console.log(`Creating shareable link...`);

	const response = await fetchApi<string>(API.sharePresentation, "POST", {
		presentation_id: presentationId,
	});

	return response;
}

async function createPresentationFromWebsite(websiteUrl: string) {
	try {
		console.log("Starting presentation creation from", websiteUrl);

		const websiteData = await scrapeWebsite(websiteUrl);
		const { presentationId, initialSlideId } = await createPresentation();
		const outlines = await generateSlideOutlines(websiteData, presentationId);
		const { slides } = await createSlidesFromOutlines(
			websiteData,
			presentationId,
			initialSlideId!,
			outlines,
		);

		console.log(`Processing ${slides.length} slides...`);
		for (let i = 0; i < slides.length; i++) {
			const slide = slides[i];
			try {
				await fetchApi(API.updateSlide, "POST", slide);

				const variantId = await createSlideVariants(
					presentationId,
					slide as SlideData,
				);

				if (variantId) {
					await fetchApi(API.setActiveVariant, "POST", {
						slide_id: slide?.slide_outline.slide_id,
						variant_id: variantId,
					});
				}
			} catch (err) {
				if (err instanceof Error) {
					console.error(`Error processing slide ${i + 1}: ${err.message}`);
				}
			}
		}

		const shareResponse = await sharePresentation(presentationId);

		console.log("Presentation created successfully!");
		console.log("Share URL: ", API.shareableLink(shareResponse));
	} catch (error) {
		if (error instanceof Error) {
			console.error("Error generating presentation", error);
		}
	}
}

const url = "github.com";

createPresentationFromWebsite(url)
	.then(() => process.exit(0))
	.catch(() => {
		console.error("Failed to create presentation");
		process.exit(1);
	});
