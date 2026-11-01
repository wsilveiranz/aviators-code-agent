# SKILL: News from Community

## Objective
Create Community section from LinkedIn activity URLs → scrape author/links → fetch external pages → generate 80-100 word summaries → output HTML.

## MANDATORY: You MUST call scrapeLinkedIn FIRST
Before calling createCommunityNews, you MUST:
1. Call scrapeLinkedIn with the LinkedIn URLs provided by the user
2. Use the ACTUAL data returned from scrapeLinkedIn
3. Do NOT fabricate any author names, titles, or summaries

If scrapeLinkedIn fails or returns empty, tell the user and ask for help. DO NOT make up content.

## BATCH PROCESSING (important for reliability)
scrapeLinkedIn processes URLs in batches of 3 by default. You MUST follow this loop until ALL URLs are processed:

1. Call scrapeLinkedIn with all URLs (it will process the first 3)
2. Process the batch: navigate external links, extract titles, write summaries
3. Call createCommunityNews with the processed items and pass hasMore: true if more batches remain
4. **MANDATORY**: Check the scrapeLinkedIn response. If hasMore is true, you MUST call scrapeLinkedIn again with the remainingUrls array. Do NOT stop processing.
5. Process the next batch and call createCommunityNews with only that batch's items and hasMore value
6. Repeat steps 4-5 until hasMore is false. On the final batch, pass hasMore: false (or omit it) to createCommunityNews.

**CRITICAL**: Never stop before all URLs are processed. Even if only 1 or 2 URLs remain, they MUST be scraped and added to the section.
Never pass prior newsletter HTML to createCommunityNews. The extension securely replaces stale Community output on the first batch of a generation and accumulates later batches in trusted extension state. If the participant offers "Continue pending Community News" after a safety stop, use that action to resume the same generation.

## Reporting Skipped URLs
If any URLs fail during scraping (check the skippedUrls array in the scrapeLinkedIn response):
- Tell the user which URLs were skipped and why (e.g., "Skipped https://... — timeout/connection error")
- Continue processing the remaining successful items normally

## Step-by-Step Workflow

### Step 1: Scrape LinkedIn Activities (in batches)
Call scrapeLinkedIn tool with:
- urls: Array of LinkedIn URLs like ["https://linkedin.com/feed/update/..."]

The tool returns: items (scraped content), hasMore, remainingUrls.

### Step 2: Navigate to External Links
For EACH item from Step 1, call playwright_navigate with the externalLink URL.
From the page content, extract:
- Title: Look for heading elements, og:title, or page title
- Summary content: Look for article text, og:description, or main content

### Step 3: Generate Summaries (80-100 words each)
For each article, write an 80-100 word summary following these rules:
| Rule | Details |
|------|---------|
| Tone | Neutral, third-person, informative |
| Structure | Problem/topic → techniques/solutions → value/benefit |
| Avoid | Author quotes, title repetition, marketing phrases, ellipses |

### Step 4: Call createCommunityNews
Call the createCommunityNews skill with items array. EACH item MUST have:
- externalLink: The article URL (from scrapeLinkedIn result)
- title: Extracted article title (from playwright_navigate)
- authorProfile: LinkedIn profile URL (from scrapeLinkedIn result)
- authorName: Author's name (from scrapeLinkedIn result)
- summary: Your 80-100 word summary (based on actual content)
- itemKind: "Post" or "Video" (from scrapeLinkedIn result)

For ALL batches, also pass:
- hasMore: true if there are more URLs to process after this batch, false (or omit) for the final batch

Each call returns a structured Community batch containing only the new escaped items. Do not copy prior output into later calls; the extension output writer performs the trusted first-batch replacement and continuation accumulation.

### Step 5: Continue with remaining URLs
If scrapeLinkedIn returned hasMore: true, you MUST go back to Step 1 with remainingUrls. Do NOT stop early.

## HTML Output Format
Each item becomes:
```html
<h5><a href="{externalLink}">{title}</a></h5>
<p>{itemKind} by <a href="{authorProfile}"><em>{authorName}</em></a></p>
<p>{summary}</p>
```