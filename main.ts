import FirecrawlApp, { type ScrapeResponse } from "@mendable/firecrawl-js";
import crypto from "crypto";
import { WebSocket } from "ws";

const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
const token = process.env.ACCESS_TOKEN;

const generateSlidesOutlinesWs = new WebSocket(
	"wss://alai-standalone-backend.getalai.com/ws/generate-slides-outline",
);

const slidesFromOutlineWs = new WebSocket(
	"wss://alai-standalone-backend.getalai.com/ws/create-slides-from-outlines",
);

const createSlideVariantsWs = new WebSocket(
	"wss://alai-standalone-backend.getalai.com/ws/create-and-stream-slide-variants",
);

async function scrapteWebsite() {
	const scrapeResult = (await app.scrapeUrl("google.com", {
		formats: ["markdown"],
	})) as ScrapeResponse;

	if (!scrapeResult.success) {
		throw new Error(`Failed to scrape: ${scrapeResult.error}`);
	}

	return scrapeResult;
}

// Create new presentation in Alai
async function createNewPresentation() {
	const presentation_uuid = crypto.randomUUID();

	const createNewPresentationBody = {
		presentation_id: presentation_uuid,
		presentation_title: "Untitled Presentation",
		create_first_slide: true,
		theme_id: "a6bff6e5-3afc-4336-830b-fbc710081012",
		default_color_set_id: 0,
	};

	const response = await fetch(
		"https://alai-standalone-backend.getalai.com/create-new-presentation",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(createNewPresentationBody),
		},
	);

	const res = await response.json();
	console.log("Create new presentation response", res);

	// @ts-ignore
	const presentationId = res.id;
	// @ts-ignore
	const slideId = res.slides[0].id;

	const presentationQuestionsRequest = await fetch(
		`https://alai-standalone-backend.getalai.com/get-presentation-questions/${presentationId}`,
		{
			headers: {
				Authorization: `Bearer ${token}`,
			},
		},
	);

	const presentationQuestions = await presentationQuestionsRequest.json();

	const websiteData = await scrapteWebsite();

	const now = new Date();
	const isoString = now.toISOString();

	const generateOutlinePayload = {
		auth_token: token,
		presentation_id: presentationId,
		presentation_instructions: "",
		presentation_questions: presentationQuestions,
		raw_context: `markdown: ${websiteData.markdown},
metadata: ${websiteData.metadata}`,
		slide_order: 0,
		slide_range: "2-5",
	};

	const slidesOutlines: any = [];

	generateSlidesOutlinesWs.send(JSON.stringify(generateOutlinePayload));
	generateSlidesOutlinesWs.on("error", console.error);
	generateSlidesOutlinesWs.on("message", (data) => {
		const jsonData = JSON.parse(data.toString());
		slidesOutlines.push(jsonData);
	});

	await new Promise((res) => setTimeout(res, 10000));

	const createSlidesFromOutlinePayload = {
		auth_token: token,
		presentation_id: presentationId,
		presentation_instructions: "",
		raw_context: `${websiteData}`,
		slide_id: slideId,
		slide_outlines: [...slidesOutlines],
		starting_slide_order: 0,
		update_tone_verbosity_calibration_status: true,
	};

	let slidesData: any = [];
	let messageCount = 0;
	const MAX_MESSAGES = 6;

	let slideIdToRemove: string;
	slidesFromOutlineWs.send(JSON.stringify(createSlidesFromOutlinePayload));
	slidesFromOutlineWs.on("message", (data) => {
		const jsonData = JSON.parse(data.toString());
		console.log("DATA:", jsonData, "\n end \n");
		if (jsonData.slides) {
			slidesData = jsonData.slides;
		}
		if (jsonData.slide_id && slideIdToRemove === undefined) {
			slideIdToRemove = jsonData.slide_id;
		}
	});

	// return;
	const filteredSlides = slidesData.filter((slide: any) => {
		slide.slide_outline.slide_id !== slideIdToRemove;
	});

	// @ts-ignore
	console.log("Slide To remove", slideIdToRemove);
	for (let slidePayload of filteredSlides) {
		console.log("Slide ID: ", slidePayload.id);
		const response = await fetch(
			"https://alai-standalone-backend.getalai.com/update-slide-entity",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(slidePayload),
			},
		);

		const result = await response.json();
		// console.log("Slide", result);

		let createSlideVariantsPayload = {
			// @ts-ignore
			additional_instructions: result.slide_outline.slide_instructions,
			auth_token: token,
			images_on_slide:
				// @ts-ignore
				result.slide_outline.images_on_slide !== null
					? // @ts-ignore
						[...result.slide_outline.images_on_slide]
					: [],
			layout_type: "AI_GENERATED_LAYOUT",
			presentation_id: presentationId,
			// @ts-ignore
			slide_id: result.slide_outline.slide_id,
			// @ts-ignore
			slide_specific_context: result.slide_outline.slide_context,
			// @ts-ignore
			slide_title: result.slide_outline.slide_title,
			update_tone_verbosity_calibration_status: false,
		};

		let activeVariantId = "";

		createSlideVariantsWs.send(JSON.stringify(createSlideVariantsPayload));
		createSlideVariantsWs.on("message", (data) => {
			const jsonData = JSON.parse(data.toString());
			if (jsonData.slide_id) {
				activeVariantId = jsonData.id;
			}
		});

		await new Promise((res) => setTimeout(res, 30 * 1000));

		await fetch(
			"https://alai-standalone-backend.getalai.com/set-active-variant",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					// @ts-ignore
					slide_id: result.id,
					variant_id: activeVariantId,
				}),
			},
		);
	}
}

createNewPresentation();


