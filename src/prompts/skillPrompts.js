/**
 * Skill Prompts
 * Detailed prompts for each newsletter skill, loaded on-demand
 */

export const SKILL_PROMPTS = {
  communityNews: `# SKILL: News from Community

## Objective
Create Community section from LinkedIn activity URLs → scrape author/links → fetch external pages → generate 80-100 word summaries → output HTML.

## MANDATORY: You MUST call scrapeLinkedIn FIRST
Before calling createCommunityNews, you MUST:
1. Call scrapeLinkedIn with the LinkedIn URLs provided by the user
2. Use the ACTUAL data returned from scrapeLinkedIn
3. Do NOT fabricate any author names, titles, or summaries

If scrapeLinkedIn fails or returns empty, tell the user and ask for help. DO NOT make up content.

## BATCH PROCESSING (important for reliability)
scrapeLinkedIn processes URLs in batches of 3 by default. Follow this loop:

1. Call scrapeLinkedIn with all URLs (it will process the first 3)
2. Process the batch: navigate external links, extract titles, write summaries
3. Call createCommunityNews with the processed items (no existingHtml on first batch)
4. If scrapeLinkedIn returned hasMore: true, call it again with the remainingUrls
5. Process the next batch and call createCommunityNews with existingHtml set to the html from the previous call
6. Repeat until hasMore is false

This ensures each batch is saved to the newsletter before processing the next one.

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

For the SECOND batch onwards, also pass:
- existingHtml: The html value from the previous createCommunityNews call

### Step 5: Continue with remaining URLs
If scrapeLinkedIn returned hasMore: true, go back to Step 1 with remainingUrls.

## HTML Output Format
Each item becomes:
\`\`\`html
<h5><a href="{externalLink}">{title}</a></h5>
<p>{itemKind} by <a href="{authorProfile}"><em>{authorName}</em></a></p>
<p>{summary}</p>
\`\`\``,

  aceAviator: `# SKILL: Ace Aviator of the Month

## Objective
Extract Q&A from email and generate properly formatted HTML section.

## Inputs
- Month (e.g., "February 2026")
- Email Subject (for inbox search) or Email Body (if pasted)
- Full Name, LinkedIn URL

## Workflow
1. Call getEmailFromMCP(subject, from) to retrieve the email
2. Parse the email body to extract Q&A pairs (YOU must do this, not the skill)
3. Call createAceAviator with the parsed data

## CRITICAL: Email Thread Handling
The email may contain:
- The Ace Aviator's RESPONSE with answers to questions (USE THIS)
- The ORIGINAL invitation email with the questions template (IGNORE THIS)
- Signatures, footers, quoted text (IGNORE THIS)

**Only extract the ANSWERS from the Ace Aviator's response.**
Look for patterns like "On [date] wrote:" or "Den [date] skrev" - everything AFTER that is the original email and should be ignored.

## The 6 Canonical Questions
1. What's your role and title? What are your responsibilities?
2. Can you give us some insights into your day-to-day activities?
3. What motivates and inspires you to be an active member of the Aviators/Microsoft community?
4. Looking back, what advice do you wish you had been given earlier?
5. What has helped you grow professionally?
6. If you had a magic wand that could create a feature in Logic Apps, what would it be?

## Calling createAceAviator
After parsing the email, call createAceAviator with:
\`\`\`
createAceAviator({
  month: "February 2026",
  name: "Camilla Bielk",
  linkedin: "https://linkedin.com/in/...",
  qaPairs: [
    { question: "What's your role and title?", answer: "I'm a developer and solution architect..." },
    { question: "Can you give us some insights into your day-to-day?", answer: "A typical day starts with..." },
    // ... all 6 Q&A pairs
  ]
})
\`\`\`

CRITICAL: 
- YOU must parse the email and extract the Q&A pairs
- Pass the qaPairs array to createAceAviator
- Each question/answer must be a separate object in the array
- Do NOT include content from the original invitation email
- Do NOT include email signatures or footers in the answers`,

  productGroup: `# SKILL: News from Product Group

## Objective
Crawl Tech Community Integration on Azure blog, filter by date window + Logic Apps relevance, generate product group table rows.

## CRITICAL RULES
1. **NO FABRICATION** - If navigation fails, STOP and ask user for URLs
2. **USE getTechCommunityBlogPosts** - This tool does date filtering automatically
3. **EXCLUDE NEWSLETTERS** - Skip any post with "Aviators Newsletter" in the title
4. **MUST CALL createProductGroupNews** - After fetching posts, you MUST call this skill to generate HTML

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
   \`\`\`
   createProductGroupNews({
     month: "February 2026",
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
   \`\`\`
7. The skill requires the posts array with title, link, publishedAt, and summary for each post
8. Do NOT start Community News until createProductGroupNews has been called and returned HTML

## Summary Rules (80-120 words, STRICT)
- Summaries MUST be based on actual article content you read
- If you cannot read the article, skip that post
- Tone: Neutral, third-person, informative
- Structure: What it is → key features/capabilities → benefit to reader
- Avoid: Marketing hype, "excited to announce", ellipses

## HTML Output Format
\`\`\`html
<tr>
  <td><img src="{ImageUrl}" alt="{Title}" style="max-width: 200px;"></td>
  <td>
    <h5><a href="{Link}" target="_blank" rel="noopener noreferrer">{Title}</a></h5>
    <p>{Summary}</p>
  </td>
</tr>
\`\`\``,

  dateWindow: `# SKILL: Date Window Helper

## Objective
Given Month → compute window in Pacific Time (America/Los_Angeles).

## Input
- Month (e.g., "February 2026")

## Output
- startPST: first Tuesday of previous month at 00:00 PST
- endPST: first Sunday of current month at 23:59 PST

Use the computeDateWindow tool to calculate this.`
};

/**
 * Detect which skill is needed based on user message
 * @param {string} message - User's message
 * @returns {string[]} - Array of skill keys to load
 */
export function detectRequiredSkills(message) {
  const lowerMessage = message.toLowerCase();
  const skills = [];

  // Community News detection
  if (
    lowerMessage.includes('community') ||
    lowerMessage.includes('linkedin') ||
    lowerMessage.includes('community news') ||
    lowerMessage.includes('community section')
  ) {
    skills.push('communityNews');
  }

  // Ace Aviator detection
  if (
    lowerMessage.includes('ace aviator') ||
    lowerMessage.includes('aviator of the month') ||
    lowerMessage.includes('q&a') ||
    lowerMessage.includes('interview') ||
    (lowerMessage.includes('email') && lowerMessage.includes('aviator'))
  ) {
    skills.push('aceAviator');
  }

  // Product Group detection
  if (
    lowerMessage.includes('product group') ||
    lowerMessage.includes('tech community') ||
    lowerMessage.includes('blog post') ||
    lowerMessage.includes('product news')
  ) {
    skills.push('productGroup');
  }

  // Date Window detection
  if (
    lowerMessage.includes('date window') ||
    lowerMessage.includes('pst window') ||
    lowerMessage.includes('time frame') ||
    lowerMessage.includes('date range')
  ) {
    skills.push('dateWindow');
  }

  // Full newsletter - load all skills
  if (
    lowerMessage.includes('full newsletter') ||
    lowerMessage.includes('create newsletter') ||
    lowerMessage.includes('entire newsletter') ||
    lowerMessage.includes('create the newsletter') ||
    (lowerMessage.includes('newsletter') && /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(lowerMessage))
  ) {
    return ['dateWindow', 'aceAviator', 'productGroup', 'communityNews'];
  }

  return skills;
}

/**
 * Build dynamic system prompt with only required skills
 * @param {string} basePrompt - Base system prompt
 * @param {string[]} skillKeys - Skills to include
 * @returns {string} - Full system prompt
 */
export function buildDynamicPrompt(basePrompt, skillKeys) {
  if (!skillKeys || skillKeys.length === 0) {
    return basePrompt;
  }

  const skillPrompts = skillKeys
    .filter(key => SKILL_PROMPTS[key])
    .map(key => SKILL_PROMPTS[key])
    .join('\n\n---\n\n');

  return `${basePrompt}

---

${skillPrompts}`;
}
