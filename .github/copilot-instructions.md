# Copilot Instructions

## Build, Test, and Run

```bash
npm install            # Install backend dependencies
npm test               # Run all tests (test/run.js spawns each test file)
node test/aceAviator.test.js   # Run a single test file directly

npm start              # Start Express server + Vite UI together (via concurrently)
npm run server         # Express API server only (src/server.js) — requires .env with AZURE_OPENAI_API_KEY
npm run ui             # Vite dev server only for React frontend (cd ui && npm run dev)
npm run chat           # CLI chat mode (node src/chat.js)
```

UI has its own `package.json` in `ui/` — run `cd ui && npm install` separately.  
Lint is only available for the UI: `cd ui && npm run lint` (ESLint 9, flat config).

## Architecture

This is an AI-powered newsletter generation agent. The Express backend (`src/server.js`) runs an OpenAI function-calling loop against Azure OpenAI, invoking **skills** (high-level section generators) and **tools** (low-level data fetchers) until the LLM produces the final newsletter HTML.

### Agent Core (`src/agent.js`)

Central registry that exports `skills` and `tools` maps, plus `executeSkill`/`executeTool` dispatch functions. Skills and tools are defined as objects with `{ name, description, parameters, execute }` — the same shape used for OpenAI function-calling definitions.

### Skills (`src/skills/`)

Each skill generates one newsletter section and returns `{ success, html, ... }`:

| Skill | Purpose |
|-------|---------|
| `computeDateWindow` | Calculates PST date range (first Tuesday of prev month → first Sunday of current month) |
| `createAceAviator` | Generates Q&A interview HTML from email body or pre-parsed `qaPairs` array |
| `createProductGroupNews` | Filters Tech Community blog posts by date window, deduplicates, generates HTML table |
| `createCommunityNews` | Builds community section from scraped LinkedIn activity items |

### Tools (`src/tools/`)

Tools wrap external integrations via MCP (Model Context Protocol) or direct execution:
- `emailMcpClient.js` — Email retrieval via EmailCompanion MCP (Microsoft Graph)
- `mcpClient.js` — Playwright MCP for browser automation + Tech Community blog fetching
- `playwrightTool.js` — LinkedIn scraping via Playwright subprocess

### Prompt System (`src/prompts/skillPrompts.js`)

Skill prompts are loaded on-demand. `detectRequiredSkills(message)` analyzes the user message for keywords and returns which skill prompts to inject. `buildDynamicPrompt(base, skillKeys)` concatenates only the needed prompts into the system message.

### Frontend (`ui/`)

React 19 + Vite SPA. Split-pane layout: chat on left, HTML preview on right. Receives real-time updates via SSE from the Express server (`section_complete` events).

## Key Conventions

- **ES Modules throughout** — all files use `import`/`export`, `"type": "module"` in package.json.
- **No test framework** — tests are plain Node.js scripts using custom `test()`, `assertEqual()`, `assertTrue()` helpers. Each test file is self-contained and runnable with `node test/<file>.test.js`.
- **Skill/tool shape** — every skill and tool is an object: `{ name, description, parameters (JSON Schema), execute: async (params) => result }`. This shape is consumed both by the agent registry and by OpenAI function-calling.
- **HTML output convention** — skills return `{ success: boolean, html: string, ... }`. Section HTML uses specific `id` anchors: `aceaviator`, `productnews`, `communitynews`.
- **Anti-fabrication guardrail** — the system prompt and skill prompts explicitly prohibit the LLM from inventing content. Skills validate against fabricated data.
- **Sequential section processing** — the system enforces generating sections one at a time (Ace Aviator → Product Group → Community) to prevent data mixing.
- **Console logging pattern** — skills/tools use `console.log` with bracketed prefixes like `[AceAviator]`, `[ProductGroup]` for traceability.
- **Environment config** — `.env` file required for Azure OpenAI credentials. See `.env.example` for the four required variables (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_MODEL`).

## MCP Servers

### Playwright (Docker)

The Playwright MCP server runs as a container for browser automation (LinkedIn scraping, Tech Community blog fetching). Use the `microsoft/playwright-mcp` image with `--headless` mode:

```json
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "mcr.microsoft.com/playwright/mcp"
      ]
    }
  }
}
```

This provides tools: `playwright_navigate`, `playwright_snapshot`, `playwright_click`, `playwright_type`.
