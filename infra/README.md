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
```

The script:
1. Provisions infrastructure via Bicep (ACR, Container Apps, Static Web App, RBAC)
2. Builds and pushes the container image to ACR
3. Updates the Container App with the new image
4. Builds the React UI with the Container App URL baked in
5. Deploys the UI to Static Web Apps

### 3. Register in Foundry (manual portal step)

1. Open Azure AI Foundry portal → your project
2. **Operate → Register agent**
3. Provide the Container App URL (port 8088)
4. Set protocol to HTTP

## CI/CD

GitHub Actions runs tests automatically on push to `main` and on PRs (`.github/workflows/test.yml`). Deployment is handled locally via `deploy.ps1`.

## Manual Deployment

```powershell
# Set subscription
az account set --subscription "Logic Apps Demo"

# Create resource group
az group create --name rg-aviators --location australiaeast

# Deploy infrastructure
az deployment group create `
  --resource-group rg-aviators `
  --template-file infra/main.bicep `
  --parameters infra/main.bicepparam

# Build and push container image
az acr build --registry acrAviators --image aviators-agent:latest .
```

After deployment, note outputs: `containerAppUrl`, `staticWebAppUrl`, `staticWebAppDeploymentToken`. Wait ~5 minutes for RBAC propagation before testing.
