# Infrastructure Deployment

## Quick Start

### 1. Configure Parameters

Edit `infra/main.bicepparam` with your values:

| Parameter | Description |
|-----------|-------------|
| `azureOpenAIResourceId` | Full resource ID of your Azure OpenAI resource |
| `emailMcpEndpoint` | EmailCompanion MCP server URL |
| `emailMcpApiKey` | EmailCompanion MCP API key |

### 2. Deploy

Run the deploy script from the project root (requires `az login`):

```powershell
.\infra\deploy.ps1                    # Full deploy (infra + agent + UI)
.\infra\deploy.ps1 -SkipInfra         # Skip Bicep, just rebuild and deploy
.\infra\deploy.ps1 -InfraOnly         # Provision infra only
.\infra\deploy.ps1 -UploadStorage C:\path\to\storage.json  # Upload LinkedIn storage file
```

The script:
1. Provisions infrastructure via Bicep (ACR, Container Apps, Static Web App, Storage Account, RBAC)
2. Builds and pushes the container image to ACR
3. Updates the Container App with the new image
4. Builds the React UI with the Container App URL baked in
5. Deploys the UI to Static Web Apps

### 3. Upload LinkedIn Storage (for Playwright scraping)

The Playwright MCP sidecar needs a `storage.json` file with LinkedIn session cookies for authenticated scraping. This file is stored in an Azure Files share mounted to both containers.

```powershell
# Upload or update storage.json (no redeploy needed)
.\infra\deploy.ps1 -SkipInfra -UploadStorage C:\path\to\storage.json

# Or upload during a full deploy
.\infra\deploy.ps1 -UploadStorage C:\path\to\storage.json
```

You can also upload directly via Azure Storage Explorer or the portal:
- Storage account: `staviators`
- File share: `playwright-state`
- File: `storage.json`

After uploading, restart the container to pick up changes:
```powershell
az containerapp revision restart -n ca-aviators-agents -g rg-aviators
```

### 4. Update Email MCP Credentials (no redeploy needed)

```powershell
az containerapp secret set --name ca-aviators-agents -g rg-aviators `
  --secrets email-mcp-endpoint=<new-url> email-mcp-api-key=<new-key>
az containerapp revision restart -n ca-aviators-agents -g rg-aviators
```

### 5. Register in Foundry (manual portal step)

1. Open Azure AI Foundry portal -> your project
2. **Operate -> Register agent**
3. Provide the Container App URL: `https://ca-aviators-agents.jollyplant-095ac134.australiaeast.azurecontainerapps.io/responses`
4. Set protocol to HTTP

## CI/CD

GitHub Actions runs tests automatically on push to `main` and on PRs (`.github/workflows/test.yml`). Deployment is handled locally via `deploy.ps1`.

## Architecture

| Resource | Name | Purpose |
|----------|------|---------|
| Container Registry | `acraviators` | Stores agent container image |
| Container Apps Env | `cae-aviators` | Hosts containers with Log Analytics |
| Container App | `ca-aviators-agents` | Agent API + Playwright MCP sidecar |
| Static Web App | `swa-aviators-ui` | React UI frontend |
| Storage Account | `staviators` | Azure Files for Playwright storage.json |
| Log Analytics | `law-aviators` | Container and app logs |
| Application Insights | `ai-aviators` | OpenTelemetry auto-instrumentation |

After deployment, note outputs: `containerAppUrl`, `staticWebAppUrl`, `staticWebAppDeploymentToken`. Wait ~5 minutes for RBAC propagation before testing.
