# Logic Apps Aviators Newsletter Agent

A Node.js-based code agent using Copilot SDK patterns for creating the Logic Apps Aviators Newsletter.

## Overview

This agent automates the creation of the Logic Apps Aviators Newsletter by:
1. Extracting Ace Aviator Q&A from email
2. Gathering Product Group news from Tech Community
3. Processing Community links from LinkedIn activities

## Installation

```bash
npm install
```

## Usage

### Show Agent Info
```bash
npm start
```

### Run Demo
```bash
npm start -- --demo
```

### Programmatic Usage
```javascript
import { executeSkill, executeTool } from './src/index.js';

// Compute date window
const dateWindow = await executeSkill('computeDateWindow', { month: 'February 2026' });

// Create Ace Aviator section
const aceSection = await executeSkill('createAceAviator', {
  month: 'February 2026',
  emailBody: '...',
  name: 'John Doe',
  linkedin: 'https://linkedin.com/in/johndoe'
});

// Fetch Product Group posts with pagination
const blogPosts = await executeTool('getTechCommunityBlogPosts', {
  month: 'February 2026',
  startDate: '2026-01-06',
  endDate: '2026-02-01',
  offset: 0,
  limit: 10
});

// Check if more posts available
if (blogPosts.hasMore) {
  const morePosts = await executeSkill('appendProductGroupPosts', {
    month: 'February 2026',
    startDate: '2026-01-06',
    endDate: '2026-02-01',
    offset: blogPosts.offset + blogPosts.batchSize
  });
}

// Create Community News section
const communitySection = await executeSkill('createCommunityNews', {
  items: [
    {
      externalLink: 'https://example.com/article',
      title: 'Article Title',
      authorName: 'Author Name',
      authorProfile: 'https://linkedin.com/in/author',
      summary: '80-100 word summary...'
    }
  ]
});
```

## Skills

| Skill | Description |
|-------|-------------|
| `computeDateWindow` | Compute PST newsletter window for a given month |
| `createAceAviator` | Extract Q&A from email, generate HTML section |
| `createProductGroupNews` | Filter and format Product Group posts (supports append mode) |
| `appendProductGroupPosts` | Fetch additional Product Group posts using pagination |
| `createCommunityNews` | Build Community section from scraped LinkedIn data |

## Tools

| Tool | Description |
|------|-------------|
| `getEmail` | Retrieve email by subject (requires MCP integration) |
| `getTechCommunityBlogPosts` | Fetch blog posts with date filtering and pagination (configurable batch size) |
| `scrapeLinkedIn` | Scrape LinkedIn activity URLs using Playwright |
| `resolveRedirects` | Post-process URLs to resolve redirects |

## Newsletter Structure

1. **Table of Contents** - Links to all sections
2. **Ace Aviator of the Month** - Q&A interview with featured community member
3. **News from Product Group** - Tech Community blog posts about Logic Apps (supports pagination for >10 posts)
4. **News from Community** - Community-contributed articles and videos

## Configuration

The agent uses environment variables for configuration. Copy `.env.example` to `.env` and configure:

### Azure OpenAI
```bash
AZURE_OPENAI_ENDPOINT=https://your-endpoint.cognitiveservices.azure.com/
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_API_VERSION=2025-01-01-preview
AZURE_OPENAI_MODEL=gpt-5-2
```

### Product Group Post Pagination
```bash
# Default number of posts per batch (default: 10)
PRODUCT_GROUP_BATCH_SIZE=10

# Maximum number of posts per batch (default: 20)
PRODUCT_GROUP_MAX_BATCH_SIZE=20
```

When fetching Product Group posts, the tool returns posts in batches with pagination metadata:
- `hasMore`: Boolean indicating more posts available
- `totalPosts`: Total matching posts count
- `returnedPosts`: Posts in current batch
- `batchSize`: Posts per batch
- `offset`: Current offset for pagination

The LLM automatically handles pagination by calling `appendProductGroupPosts` when `hasMore: true`.

### Playwright Integration
The agent uses these paths for Playwright tools:
- Storage: `.github/tools/playwright-login/storage.json`
- Scraper: `.github/tools/playwright-scrape/run-sequential.js`
- Post-processor: `.github/tools/playwright-scrape/post-process-playwright.js`

## Integration with Copilot

This agent exposes skill and tool definitions compatible with LLM function calling:

```javascript
import { getSkillDefinitions, getToolDefinitions } from './src/index.js';

// Get definitions for function calling
const skills = getSkillDefinitions();
const tools = getToolDefinitions();
```

## License

Private - Logic Apps Aviators Team
