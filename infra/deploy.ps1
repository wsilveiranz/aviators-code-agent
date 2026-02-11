# Deploy Aviators Newsletter Agent to Azure
# Provisions infrastructure, builds container, and deploys UI.
#
# Prerequisites:
#   - Azure CLI (az) logged in
#   - Node.js 20+ and npm
#
# Usage:
#   .\infra\deploy.ps1                    # Full deploy (infra + agent + UI)
#   .\infra\deploy.ps1 -SkipInfra         # Skip Bicep, just rebuild and deploy
#   .\infra\deploy.ps1 -InfraOnly         # Provision infra only

param(
    [switch]$SkipInfra,
    [switch]$InfraOnly
)

$ErrorActionPreference = 'Stop'

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────

$SubscriptionName  = "Logic Apps Demo"
$ResourceGroup     = "rg-aviators"
$Location          = "australiaeast"
$AcrName           = "acrAviators"
$ContainerAppName  = "ca-aviators-agents"

# ──────────────────────────────────────────────
# Set subscription
# ──────────────────────────────────────────────

Write-Host "🔍 Setting subscription '$SubscriptionName'..."
az account set --subscription $SubscriptionName
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to set subscription. Run 'az login' first."
    exit 1
}

# ──────────────────────────────────────────────
# Provision infrastructure (Bicep)
# ──────────────────────────────────────────────

if (-not $SkipInfra) {
    Write-Host ""
    Write-Host "📦 Creating resource group '$ResourceGroup'..."
    az group create --name $ResourceGroup --location $Location --output none

    Write-Host "🏗️  Deploying Bicep template..."
    $deployOutput = az deployment group create `
        --resource-group $ResourceGroup `
        --template-file infra/main.bicep `
        --parameters infra/main.bicepparam `
        --query "properties.outputs" `
        --output json | ConvertFrom-Json

    $ContainerAppUrl = $deployOutput.containerAppUrl.value
    $SwaUrl          = $deployOutput.staticWebAppUrl.value
    $SwaToken        = $deployOutput.staticWebAppDeploymentToken.value
    $AcrLoginServer  = $deployOutput.acrLoginServer.value

    Write-Host "   ✅ Infrastructure deployed"
    Write-Host "   Container App: $ContainerAppUrl"
    Write-Host "   Static Web App: $SwaUrl"

    if ($InfraOnly) {
        Write-Host ""
        Write-Host "✅ Infra-only deploy complete."
        exit 0
    }
} else {
    # Fetch existing values
    Write-Host "⏭️  Skipping infra, fetching existing resource info..."
    $AcrLoginServer = az acr show --name $AcrName --query loginServer -o tsv
    $ContainerAppUrl = az containerapp show --name $ContainerAppName --resource-group $ResourceGroup `
        --query "properties.configuration.ingress.fqdn" -o tsv
    $ContainerAppUrl = "https://$ContainerAppUrl"
    $SwaToken = az staticwebapp secrets list --name "swa-aviators-ui" --query "properties.apiKey" -o tsv
}

# ──────────────────────────────────────────────
# Build and push container image
# ──────────────────────────────────────────────

Write-Host ""
Write-Host "🐳 Building and pushing container image..."
$ImageTag = git rev-parse --short HEAD
az acr build --registry $AcrName `
    --image "aviators-agent:$ImageTag" `
    --image "aviators-agent:latest" `
    .

# ──────────────────────────────────────────────
# Update Container App
# ──────────────────────────────────────────────

Write-Host ""
Write-Host "🚀 Deploying agent to Container Apps..."
az containerapp update `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    --image "${AcrLoginServer}/aviators-agent:${ImageTag}"

# ──────────────────────────────────────────────
# Build and deploy UI
# ──────────────────────────────────────────────

Write-Host ""
Write-Host "🎨 Building UI..."
$env:VITE_API_BASE = $ContainerAppUrl
Push-Location ui
npm ci
npm run build
Pop-Location

Write-Host "☁️  Deploying UI to Static Web Apps..."
# Install SWA CLI if needed
if (-not (Get-Command swa -ErrorAction SilentlyContinue)) {
    npm install -g @azure/static-web-apps-cli
}
swa deploy ui/dist --deployment-token $SwaToken --env production

# ──────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────

Write-Host ""
Write-Host "✅ Deployment complete!"
Write-Host ""
Write-Host "   Agent API:  $ContainerAppUrl"
Write-Host "   Foundry:    ${ContainerAppUrl}:8088/responses"
Write-Host "   UI:         $SwaUrl"
Write-Host ""
Write-Host "⏳ If this is the first deploy, wait ~5 minutes for RBAC propagation."
Write-Host ""
