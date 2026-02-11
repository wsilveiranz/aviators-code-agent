# Infrastructure Deployment

## Automated Setup (Recommended)

### 1. Bootstrap (one-time)

Run the bootstrap script to create a service principal and set GitHub Actions secrets/variables:

```bash
# Prerequisites: az login, gh auth login, jq
chmod +x infra/bootstrap.sh
./infra/bootstrap.sh
```

This creates:
- Service principal `aviators-gh-deploy` with Contributor role on `rg-aviators`
- GitHub secrets: `AZURE_CREDENTIALS`, `AZURE_SUBSCRIPTION_ID`
- GitHub variables: `ACR_NAME`, `CONTAINER_APP_NAME`, `RESOURCE_GROUP`, `AZURE_LOCATION`

### 2. Configure Parameters

Edit `infra/main.bicepparam` with your values:

| Parameter | Description |
|-----------|-------------|
| `azureOpenAIResourceId` | Full resource ID of your Azure OpenAI resource |
| `emailMcpEndpoint` | EmailCompanion MCP server URL |
| `emailMcpApiKey` | EmailCompanion MCP API key |

### 3. Deploy

Trigger the GitHub Actions workflow — it provisions infra, builds, and deploys automatically:

- **Push to `main`** — triggers automatically
- **Manual** — Actions tab → Deploy Newsletter Agent → Run workflow → select branch

The workflow runs: `test → infra (Bicep) → deploy-agent + deploy-ui (parallel)`

### 4. Register in Foundry (manual portal step)

1. Open Azure AI Foundry portal → your project
2. **Operate → Register agent**
3. Provide the Container App URL (port 8088)
4. Set protocol to HTTP

## Manual Deployment

```bash
# Prerequisites: az login
az account set --subscription "Logic Apps Demo"

# Create resource group
az group create --name rg-aviators --location australiaeast

# Deploy infrastructure
az deployment group create \
  --resource-group rg-aviators \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam

# Build and push container image
az acr build --registry acrAviators --image aviators-agent:latest .
```

After deployment, note outputs: `containerAppUrl`, `staticWebAppUrl`, `staticWebAppDeploymentToken`. Wait ~5 minutes for RBAC propagation before testing.
