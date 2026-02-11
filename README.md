# Logic Apps Aviators Newsletter Agent

An AI-powered agent that automates creation of the Logic Apps Aviators Newsletter. It uses Azure OpenAI with function calling to orchestrate data gathering from email, Tech Community blogs, and LinkedIn — then generates formatted HTML sections ready for publishing.

[![Demo Video](https://img.youtube.com/vi/td4nzKNibC4/0.jpg)](https://www.youtube.com/watch?v=td4nzKNibC4)

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Docker](https://www.docker.com/) (for the Playwright MCP server)
- An Azure OpenAI deployment with API access

## Getting Started

1. **Clone and install dependencies:**

   ```bash
   git clone <repo-url>
   cd aviators-code-agent
   npm install
   cd ui && npm install && cd ..
   ```

2. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in your Azure OpenAI credentials:

   | Variable | Description |
   |----------|-------------|
   | `AZURE_OPENAI_ENDPOINT` | Your Azure OpenAI endpoint URL |
   | `AZURE_OPENAI_API_KEY` | Your API key |
   | `AZURE_OPENAI_API_VERSION` | API version (default: `2025-01-01-preview`) |
   | `AZURE_OPENAI_MODEL` | Deployed model name (default: `gpt-5-2`) |

3. **Start the application:**

   ```bash
   npm start
   ```

   This launches the Express API server and the React UI together. Open the URL shown by Vite (typically `http://localhost:5173`).

## Usage

| Command | Description |
|---------|-------------|
| `npm start` | Start Express server + Vite UI together |
| `npm run server` | Express API server only |
| `npm run ui` | Vite dev server only |
| `npm run chat` | CLI chat mode |
| `npm run demo` | Run demo |
| `npm test` | Run all tests |

### Creating a Newsletter

In the UI chat, ask the agent to create a newsletter for a given month:

> Create the newsletter for February 2026

The agent processes sections sequentially:

1. **Ace Aviator of the Month** — retrieves a Q&A interview from email via MCP, generates an HTML section
2. **News from Product Group** — crawls Tech Community blog posts, filters by date window, summarizes each post
3. **News from Community** — scrapes LinkedIn activity URLs, fetches linked articles, generates summaries

Each section streams to the UI preview in real time via SSE.

### Programmatic Usage

```javascript
import { executeSkill } from './src/index.js';

const dateWindow = await executeSkill('computeDateWindow', { month: 'February 2026' });

const aceSection = await executeSkill('createAceAviator', {
  month: 'February 2026',
  name: 'John Doe',
  linkedin: 'https://linkedin.com/in/johndoe',
  qaPairs: [
    { question: "What's your role and title?", answer: "I'm a developer..." }
  ]
});
```

## Architecture

The Express backend (`src/server.js`) runs an OpenAI function-calling loop, invoking **skills** (section generators) and **tools** (data fetchers) until the LLM produces the final newsletter HTML.

```
src/
├── server.js              # Express API with SSE streaming
├── agent.js               # Skill/tool registry and dispatch
├── chat.js                # CLI chat interface
├── prompts/
│   └── skillPrompts.js    # On-demand prompt loading per skill
├── skills/                # High-level section generators
│   ├── dateWindow.js      # PST date range calculation
│   ├── aceAviator.js      # Ace Aviator Q&A section
│   ├── productGroup.js    # Product Group news table
│   └── communityNews.js   # Community news section
└── tools/                 # Low-level data fetchers (MCP + direct)
    ├── emailMcpClient.js  # Email via EmailCompanion MCP
    ├── mcpClient.js       # Playwright MCP + Tech Community blog
    └── playwrightTool.js  # LinkedIn scraping via Playwright
ui/                        # React 19 + Vite frontend
```

For a detailed architecture walkthrough with diagrams, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Deployment

The agent deploys to Azure using a two-component architecture:

| Component | Hosting | Purpose |
|-----------|---------|---------|
| Express server | Azure Container Apps | Agent orchestration, skills/tools, SSE streaming (port 3001), Foundry Responses API (port 8088) |
| React UI | Azure Static Web Apps | Chat interface, HTML preview pane |

Authentication switches from API key (local dev) to **Managed Identity** when deployed. The Container App's system-assigned MI is granted the Cognitive Services OpenAI User role.

### Quick Deploy

1. **Provision infrastructure** (one-time):
   ```bash
   az deployment group create \
     --resource-group rg-aviators \
     --template-file infra/main.bicep \
     --parameters infra/main.bicepparam
   ```

2. **Build and deploy** — push to `main` to trigger the GitHub Actions workflow, or trigger manually on any branch via `workflow_dispatch`.

3. **Register in Foundry** — in the Azure AI Foundry portal, navigate to **Operate → Register agent** and provide the Container App URL (port 8088).

See [`docs/tech-spec-foundry-deployment.md`](docs/tech-spec-foundry-deployment.md) and [`infra/README.md`](infra/README.md) for full deployment instructions.

## License

Private — Logic Apps Aviators Team