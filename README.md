# Automated PPT Generator: Firecrawl + getalai.com + Bun.js

## Overview

This project is a modern automation tool that **scrapes website content using Firecrawl**, then **generates PowerPoint presentations (PPTs) via getalai.com**, all powered by the ultra-fast [Bun.js](https://bun.sh/) runtime. With a simple command, you can turn any public website into a ready-to-use presentation—no manual site visits or copy-pasting required.

## Features

- **Lightning-fast execution** with Bun.js
- **Automated web scraping** using Firecrawl
- **Seamless PPT generation** with getalai.com
- **No browser automation or manual steps**

## Tech Stack

- [Bun.js](https://bun.sh/) (JavaScript runtime)
- [@mendable/firecrawl-js](https://github.com/mendableai/firecrawl) (web scraping)
- dotenv (environment variable management)

## Prerequisites

- [Bun.js](https://bun.sh/) installed (see [installation guide](https://bun.sh/docs/installation))
- Firecrawl API key ([get yours here](https://firecrawl.dev))
- getalai.com API key (if required)

## Installation

1. **Clone the repository:**

```
git clone https://github.com/abhirajthakur/firecrawl-getalai-ppt.git
cd firecrawl-getalai-ppt
```

2. **Install dependencies with Bun:**

```
bun install
```

3. **Set up environment variables:**

```
FIRECRAWL_API_KEY=your_firecrawl_api_key
GETALAI_API_KEY=your_getalai_api_key
ACCESS_TOKEN=get_your_access_token_by_checking_the_network_tab
```

## Usage

1. **Generate a PPT from a website:**

```
bun run index.ts
```

2. **Find your output:**

You will be given a unique link for your presentation.

## How It Works

1. **Scraping:**  
   Firecrawl crawls the provided URL and extracts structured content (markdown or plain text).

2. **Processing:**  
   The application cleans and prepares the content for presentation.

3. **PPT Generation:**  
   The processed content is sent to getalai.com’s API, which returns a link to your generated presentation.
