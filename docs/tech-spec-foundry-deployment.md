# Tech Spec: Deploy Newsletter Agent to Azure AI Foundry

## Summary

Deploy the Logic Apps Aviators Newsletter Agent to Azure using a two-component architecture:

1. **Agent + API** — The Express server (agent orchestration loop, skills, tools, SSE streaming) deploys to **Azure Container Apps** with Managed Identity, registered as a Hosted Agent in Foundry for catalog visibility and governance.
2. **UI** — The React frontend deploys to **Azure Static Web Apps**, connecting to the Express backend via its Container Apps URL. SSE streaming is fully preserved.

This approach keeps the existing real-time UX (section-by-section SSE streaming) that would be lost if the agent were deployed purely as a Foundry Responses API container.

## Background

The application currently runs as a local Express server (`src/server.js`) with a React frontend (`ui/`). It uses the OpenAI SDK with API key authentication to drive an Azure OpenAI function-calling loop that orchestrates skills (section generators) and tools (data fetchers) to produce newsletter HTML.

A full newsletter generation involves dozens of tool calls over several minutes (email retrieval, blog crawling, LinkedIn scraping with rate-limiting delays). The UI relies on SSE events (`tool_start`, `tool_end`, `section_complete`) to show progress in real time. Foundry's Responses API protocol does not natively support this streaming model, so deploying the Express server directly to Container Apps — while registering it in Foundry's agent catalog — preserves the full UX.

## Requirements

### Must Have
- Express server (agent + API) deploys to Azure Container Apps
- Authentication switches from API key to Managed Identity (`@azure/identity`)
- React UI deploys to Azure Static Web Apps
- SSE streaming from Express to UI is preserved
- Existing skills, tools, and prompt system remain unchanged
- Agent is registered in Foundry's catalog for discoverability/governance
- Local development mode preserved (API key auth for local, MI for deployed)
- GitHub Actions CI/CD pipeline for automated builds, tests, and deployments

### Nice to Have
- Custom domain for both Container Apps and Static Web Apps

### Out of Scope
- Rewriting the agent in Python
- Changes to skill/tool business logic
- Changes to the prompt system

## Architecture

### Current

```
[React UI (localhost:5173)] → [Express Server (localhost:3000)] → [Azure OpenAI (API key)]
                                        ↕
                                [Skills / Tools / MCP]
```

### Target

```
[Azure Static Web Apps]  →  [Azure Container Apps (Express)]  →  [Azure OpenAI (Managed Identity)]
     (React UI)                Port 3001: Agent + API + SSE            (Foundry endpoint)
                               Port 8088: Foundry Responses API
                                        ↕
                                [Skills / Tools / MCP]
                                        │
                            [Registered in Foundry Catalog]
                                        │
                            [Foundry Playground / Clients]
```

### Component Responsibilities

| Component | Hosting | Purpose |
|-----------|---------|---------|
| Express server (`src/server.js`) | Azure Container Apps | Agent orchestration loop, skill/tool execution, SSE streaming, session management |
| React UI (`ui/`) | Azure Static Web Apps | Chat interface, HTML preview pane, SSE event consumption |
| Azure OpenAI | Foundry model endpoint | LLM reasoning (function calling) |
| MCP servers | Sidecar containers or external | Playwright browser automation, EmailCompanion email retrieval |

## Implementation Plan

### 1. Switch Authentication to Managed Identity

**Files:** `src/server.js`, `package.json`

Add `@azure/identity` dependency. Create a dual-mode auth setup that uses API key for local dev and Managed Identity when deployed:

```javascript
import { DefaultAzureCredential } from '@azure/identity';

const AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY;

let client;
if (AZURE_API_KEY) {
  // Local development — use API key
  client = new AzureOpenAI({
    endpoint: AZURE_ENDPOINT,
    apiKey: AZURE_API_KEY,
    apiVersion: AZURE_API_VERSION
  });
} else {
  // Deployed — use Managed Identity
  const credential = new DefaultAzureCredential();
  client = new AzureOpenAI({
    endpoint: AZURE_ENDPOINT,
    azureADTokenProvider: (scope) => credential.getToken(scope).then(t => t.token),
    apiVersion: AZURE_API_VERSION
  });
}
```

Remove the hard exit when `AZURE_OPENAI_API_KEY` is not set — MI mode doesn't need it.

### 2. Containerize the Express Server

**File:** new `Dockerfile` (project root)

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ src/
EXPOSE 3001 8088
CMD ["node", "src/server.js"]
```

The container exposes two ports: **3001** for the custom REST+SSE API (used by the React UI) and **8088** for the Foundry Responses API (used by Foundry Playground and clients).

### 3. Deploy Express Server to Azure Container Apps

**Prerequisites:**
- Azure Container Apps Environment provisioned

**Provision ACR and deploy:**

```powershell
# Create ACR
az acr create --name <ACR_NAME> --resource-group <RG> --sku Basic --admin-enabled true

# Build and push to ACR
az acr build --registry <ACR_NAME> --image aviators-agent:latest .

# Create Container App with Managed Identity (scale to zero when idle)
az containerapp create \
  --name aviators-newsletter-agent \
  --resource-group <RG> \
  --environment <CA_ENV> \
  --image <ACR_NAME>.azurecr.io/aviators-agent:latest \
  --target-port 3001 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 3 \
  --cpu 1 --memory 2Gi \
  --system-assigned \
  --env-vars \
    AZURE_OPENAI_ENDPOINT=<ENDPOINT> \
    AZURE_OPENAI_API_VERSION=2025-01-01-preview \
    AZURE_OPENAI_MODEL=gpt-5-2

# Set 10-minute request timeout for long-running SSE connections
az containerapp ingress update \
  --name aviators-newsletter-agent \
  --resource-group <RG> \
  --transport http \
  --target-port 3001 \
  --request-timeout 600
```

After creation, grant the Container App's system-assigned Managed Identity the **Cognitive Services OpenAI User** role on the Azure OpenAI resource:

```powershell
az role assignment create \
  --assignee <CA_MANAGED_IDENTITY_PRINCIPAL_ID> \
  --role "Cognitive Services OpenAI User" \
  --scope <AZURE_OPENAI_RESOURCE_ID>
```

Allow ~5 minutes for RBAC propagation.

### 4. Deploy React UI to Azure Static Web Apps

**File:** update `ui/src/App.jsx` (or equivalent) to use a configurable API base URL:

```javascript
const API_BASE = import.meta.env.VITE_API_BASE || '';
// Use: `${API_BASE}/api/chat/stream` instead of `/api/chat/stream`
```

**Build and deploy:**

```powershell
cd ui && npm run build
az staticwebapp create \
  --name aviators-newsletter-ui \
  --resource-group <RG> \
  --source ui/dist \
  --location eastus2

# Set environment variable pointing to Container Apps URL
az staticwebapp appsettings set \
  --name aviators-newsletter-ui \
  --setting-names VITE_API_BASE=https://aviators-newsletter-agent.<CA_ENV_DOMAIN>
```

### 5. Configure CORS on Container Apps

Update `src/server.js` CORS configuration to allow the Static Web App origin:

```javascript
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
}));
```

Set `ALLOWED_ORIGINS` env var on the Container App to the Static Web App URL.

### 6. Configure MCP Servers

**Playwright MCP** — deploy as a sidecar container in the same Container App, preserving the current stdio transport:

```powershell
az containerapp update \
  --name aviators-newsletter-agent \
  --resource-group <RG> \
  --yaml sidecar-config.yaml    # Defines Playwright MCP sidecar
```

**EmailCompanion MCP** — no changes needed. The MCP server runs through Logic Apps, which manages the connection with Outlook. The agent calls it via HTTP using the endpoint URL and API key from environment variables (`EMAIL_MCP_ENDPOINT`, `EMAIL_MCP_API_KEY`).

### 7. Foundry Responses API Endpoint

**File:** `src/server.js`

The Express server exposes a second HTTP listener on port **8088** implementing the [Foundry Responses API protocol](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/concepts/hosted-agents). This enables Foundry Playground and external clients to interact with the agent.

**Request:** `POST /responses`
```json
{
  "input": {
    "messages": [{ "role": "user", "content": "Create the newsletter for June 2025" }]
  }
}
```

**Response:**
```json
{
  "id": "resp_...",
  "object": "response",
  "output": [{ "type": "message", "role": "assistant", "content": "..." }],
  "status": "completed"
}
```

The Bicep template configures Container Apps with `additionalPortMappings` to expose port 8088 alongside the primary ingress on port 3001.

### 8. Register Agent in Foundry Catalog

Registration is a **manual portal step** (not automatable via Bicep/CLI currently):

1. Open the Azure AI Foundry portal for the project
2. Navigate to **Operate → Register agent**
3. Provide the Container App URL pointing to port 8088 (e.g., `https://ca-aviators-agents.<env-domain>:8088`)
4. Set protocol to **HTTP**, assign project and agent name
5. Foundry creates an APIM proxy URL that clients and Playground use

**Prerequisites:**
- AI Gateway (APIM) must be configured in the Foundry project
- Container App must be running and accessible on port 8088

### 9. GitHub Actions CI/CD Pipeline

**File:** new `.github/workflows/deploy.yml`

Automated deployment triggered on push to `main`. Uses a **service principal with client secret** stored in GitHub Secrets (OIDC federation not available in this tenant).

#### Prerequisites (one-time setup)

1. **Create a service principal** with Contributor role on the resource group:
   ```powershell
   az ad sp create-for-rbac --name "aviators-gh-deploy" --role Contributor \
     --scopes /subscriptions/<SUB>/resourceGroups/<RG> --sdk-auth
   ```
2. **Store these as GitHub Actions secrets:**

   | Secret | Value |
   |--------|-------|
   | `AZURE_CREDENTIALS` | Full JSON output from `az ad sp create-for-rbac --sdk-auth` |
   | `STATIC_WEB_APP_TOKEN` | Deployment token for Static Web App (from portal) |

3. **Store these as GitHub Actions variables:**

   | Variable | Value |
   |----------|-------|
   | `ACR_NAME` | Azure Container Registry name |
   | `CONTAINER_APP_NAME` | Container App name |
   | `RESOURCE_GROUP` | Resource group name |
   | `CONTAINER_APP_URL` | Container App FQDN (e.g., `https://ca-aviators-agents.<env-domain>`) |

#### Workflow Design

```yaml
name: Deploy Newsletter Agent

on:
  push:
    branches: [main]
  workflow_dispatch:        # Manual trigger on any branch
    inputs:
      deploy:
        description: Deploy after tests pass
        type: boolean
        default: true

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test

  deploy-agent:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Azure Login
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Build and push to ACR
        run: |
          az acr build \
            --registry ${{ vars.ACR_NAME }} \
            --image aviators-agent:${{ github.sha }} \
            --image aviators-agent:latest \
            .

      - name: Deploy to Container Apps
        run: |
          az containerapp update \
            --name ${{ vars.CONTAINER_APP_NAME }} \
            --resource-group ${{ vars.RESOURCE_GROUP }} \
            --image ${{ vars.ACR_NAME }}.azurecr.io/aviators-agent:${{ github.sha }}

  deploy-ui:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Build UI
        run: |
          cd ui
          npm ci
          npm run build

      - name: Deploy to Static Web Apps
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.STATIC_WEB_APP_TOKEN }}
          action: upload
          app_location: ui/dist
          skip_app_build: true
```

#### Key design decisions

- **Test gate** — both deploy jobs depend on `test` passing. No deployment if tests fail.
- **Parallel deploys** — `deploy-agent` and `deploy-ui` run in parallel after tests pass (they're independent).
- **Service principal auth** — uses `az ad sp create-for-rbac --sdk-auth` JSON stored as `AZURE_CREDENTIALS` secret. Rotate periodically.
- **Image tagging** — each build is tagged with the commit SHA for traceability, plus `latest` for convenience.
- **Manual trigger** — `workflow_dispatch` allows manually triggering on any branch (e.g., feature branches for testing) or re-deploying without a code change.

## Resolved Decisions

| Decision | Resolution |
|----------|-----------|
| **Cold start vs. cost** | Scale to zero (`minReplicas: 0`) — single user, cost over latency. |
| **Playwright MCP** | Sidecar container in the same Container App, preserving stdio transport. |
| **SSE timeout** | Set 10-minute request timeout on Container Apps ingress, test empirically. |
| **EmailCompanion MCP** | No changes — runs through Logic Apps, manages Outlook connection independently. |
| **Foundry catalog** | Required — agent must be accessible via Playground and web UI. |
| **CI/CD auth** | Service principal with client secret (OIDC not available in tenant). |
| **ACR** | Provision as part of this work. |
| **Foundry Responses API** | Implemented on port 8088 in the same Express server. Dual-port exposed via Container Apps. |

## Remaining Risks

| Item | Detail |
|------|--------|
| **MCP sidecar support** | Need to verify Playwright MCP Docker image works as a Container Apps sidecar with stdio transport. |
| **SSE through ingress** | 10-minute timeout configured, but need to verify Container Apps doesn't buffer SSE event streams. |
| **Foundry catalog registration** | Registration is a manual portal step. Requires AI Gateway (APIM) configured in Foundry project. |

## Testing

- Deploy to Container Apps and verify agent responds via the Container Apps URL
- Verify SSE streaming works end-to-end (Static Web App → Container App → SSE events)
- Verify Managed Identity auth works for Azure OpenAI calls
- Verify MCP tool connections work (email retrieval, browser automation)
- Verify CORS allows Static Web App to connect to Container App
- Verify local dev mode still works with API key fallback
- Run existing test suite (`npm test`) to confirm no skill/tool regressions
- Test container logs via `az containerapp logs show`

## References

- [Azure Container Apps overview](https://learn.microsoft.com/en-us/azure/container-apps/overview)
- [Azure Static Web Apps overview](https://learn.microsoft.com/en-us/azure/static-web-apps/overview)
- [Managed Identity for Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity)
- [Foundry Hosted Agent Concepts](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/concepts/hosted-agents?view=foundry)
- [Foundry RBAC Permissions](https://aka.ms/FoundryPermissions)
- Internal: [`docs/deploy-hosted-agent-guide.md`](deploy-hosted-agent-guide.md)
- Internal: [`docs/notes-node-foundry.txt`](notes-node-foundry.txt)
