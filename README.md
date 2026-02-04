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
| `createProductGroupNews` | Filter and format Product Group posts |
| `createCommunityNews` | Build Community section from scraped LinkedIn data |

## Tools

| Tool | Description |
|------|-------------|
| `getEmail` | Retrieve email by subject (requires MCP integration) |
| `scrapeLinkedIn` | Scrape LinkedIn activity URLs using Playwright |
| `resolveRedirects` | Post-process URLs to resolve redirects |

## Newsletter Structure

1. **Table of Contents** - Links to all sections
2. **Ace Aviator of the Month** - Q&A interview with featured community member
3. **News from Product Group** - Tech Community blog posts about Logic Apps
4. **News from Community** - Community-contributed articles and videos

## Configuration

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
