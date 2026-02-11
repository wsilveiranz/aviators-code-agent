# Infrastructure Deployment

## Prerequisites

- Azure CLI logged in (`az login`)
- Subscription set: `az account set --subscription "Logic Apps Demo"`

## Deploy

```powershell
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

## First Deployment

After `az deployment group create` completes:

1. Note the outputs: `containerAppUrl`, `staticWebAppUrl`, `staticWebAppDeploymentToken`
2. Build and push the container image to ACR
3. Deploy the UI to Static Web Apps (see GitHub Actions workflow)
4. Wait ~5 minutes for RBAC propagation before testing

## Parameters

Edit `infra/main.bicepparam` with your values before deploying:

- `azureOpenAIResourceId` — full resource ID of your Azure OpenAI resource
- `emailMcpEndpoint` — EmailCompanion MCP server URL
- `emailMcpApiKey` — EmailCompanion MCP API key
