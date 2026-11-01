# SKILL: News from Product Group

## Objective
Crawl Tech Community Integration on Azure blog, filter by date window + Logic Apps relevance, generate product group table rows.

## CRITICAL RULES
1. **NO FABRICATION** - If navigation fails, STOP and ask user for URLs
2. **USE getTechCommunityBlogPosts** - This tool does date filtering automatically
3. **EXCLUDE NEWSLETTERS** - Skip any post with "Aviators Newsletter" in the title
4. **MUST CALL createProductGroupNews** - After fetching posts, you MUST call this skill to generate HTML
5. **USER OVERRIDES DEFAULTS** - The date window is the default inclusion policy, not an absolute restriction. If the user explicitly asks to include a specific supplied post outside the window, call createProductGroupNews with includeOutsideDateWindow: true and dateWindowOverrideReason summarizing that instruction. Never infer an override yourself.

## Workflow (TWO-PHASE APPROACH)

### Phase 1: Get the list of blog posts (with automatic date filtering)
1. Call computeDateWindow tool with the month to get startPST and endPST
   - For February 2026: startPST = 2026-01-06, endPST = 2026-02-01
2. Call getTechCommunityBlogPosts with:
   - month: the newsletter month (e.g., "February 2026")
   - startDate: the startPST date in ISO format (e.g., "2026-01-06")
   - endDate: the endPST date in ISO format (e.g., "2026-02-01")
3. The tool returns ONLY posts within the date range (already filtered)
4. If no posts returned, tell user there are no Product Group updates for this period

### Phase 2: Fetch each post and generate HTML
5. For EACH post URL returned by getTechCommunityBlogPosts:
   - Call playwright_navigate with the post URL
   - Extract: title, link, image (og:image if available)
   - Write 80-120 word summary from the ACTUAL content you read
   - If navigation times out for one post, skip it and continue with others

### Phase 3: Generate Product Group section (REQUIRED)
6. **IMMEDIATELY AFTER** fetching all posts, you MUST call createProductGroupNews with ALL the posts you gathered:
   ```
   createProductGroupNews({
     month: "February 2026",
     includeOutsideDateWindow: false,
     posts: [
       { 
         title: "Introducing Unit Test Agent Profiles", 
         link: "https://techcommunity.microsoft.com/...", 
         publishedAt: "2026-01-28",
         summary: "Your 80-120 word summary...",
         imageUrl: "https://..." 
       },
       // ... include ALL posts from Phase 2
     ]
   })
   ```
7. The skill requires the posts array with title, link, publishedAt, and summary for each post
8. Do NOT start Community News until createProductGroupNews has been called and returned HTML

## Summary Rules (80-120 words, STRICT)
- Summaries MUST be based on actual article content you read
- If you cannot read the article, skip that post
- Tone: Neutral, third-person, informative
- Structure: What it is → key features/capabilities → benefit to reader
- Avoid: Marketing hype, "excited to announce", ellipses

## HTML Output Format
```html
<h5><a href="{Link}" target="_blank" rel="noopener noreferrer">{Title}</a></h5>
<p>{Summary}</p>
```