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

function Assert-AzSuccess($message) {
    if ($LASTEXITCODE -ne 0) {
        Write-Error $message
        exit 1
    }
}

# Resolve paths relative to this script's directory
$InfraDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BicepFile = Join-Path $InfraDir "main.bicep"
$ParamFile = Join-Path $InfraDir "main.bicepparam"

# Configuration
$SubscriptionName  = "Logic Apps Demo"
$ResourceGroup     = "rg-aviators"
$Location          = "australiaeast"
$AcrName           = "acraviators"
$ContainerAppName  = "ca-aviators-agents"
$SwaName           = "swa-aviators-ui"

# Set subscription
Write-Host "[1/7] Setting subscription '$SubscriptionName'..."
az account set --subscription $SubscriptionName
Assert-AzSuccess "Failed to set subscription. Run 'az login' first."

# Provision infrastructure (Bicep) unless -SkipInfra
if (-not $SkipInfra) {
    Write-Host "[2/7] Creating resource group '$ResourceGroup'..."
    az group create --name $ResourceGroup --location $Location --output none
    Assert-AzSuccess "Failed to create resource group"

    # Ensure ACR exists before building image
    Write-Host "[3/7] Ensuring container registry '$AcrName' exists..."
    az acr show --name $AcrName --resource-group $ResourceGroup --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
        az acr create --name $AcrName --resource-group $ResourceGroup --location $Location --sku Basic --admin-enabled true --output none
        Assert-AzSuccess "Failed to create container registry"
        Write-Host "   Container registry created"
    }

    # Build and push container image BEFORE Bicep
    Write-Host "[4/7] Building and pushing container image to ACR..."
    $ImageTag = git rev-parse --short HEAD
    az acr build --registry $AcrName --image "aviators-agent:$ImageTag" --image "aviators-agent:latest" .
    Assert-AzSuccess "Container image build failed"

    Write-Host "[5/7] Deploying Bicep template (this may take several minutes)..."
    $rawOutput = az deployment group create --resource-group $ResourceGroup --template-file $BicepFile --parameters $ParamFile --query "properties.outputs" --output json 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Bicep deployment failed. Check 'az deployment group show -g $ResourceGroup -n main' for details."
        exit 1
    }
    # Filter out non-JSON lines (az CLI may emit info messages)
    $jsonLines = @($rawOutput) | Where-Object { $_ -match '^\s*[\{\[\"]' -or $_ -match '^\s*\}' -or $_ -match '^\s*\]' -or $_ -match '^\s*"' }
    $deployOutput = ($jsonLines -join "`n") | ConvertFrom-Json

    $ContainerAppUrl = $deployOutput.containerAppUrl.value
    $SwaUrl          = $deployOutput.staticWebAppUrl.value
    $SwaToken        = $deployOutput.staticWebAppDeploymentToken.value
    $AcrLoginServer  = $deployOutput.acrLoginServer.value

    Write-Host "   Infrastructure deployed"
    Write-Host "   Container App: $ContainerAppUrl"
    Write-Host "   Static Web App: $SwaUrl"

    if ($InfraOnly) {
        Write-Host ""
        Write-Host "Infra-only deploy complete."
        exit 0
    }
}

# If -SkipInfra, fetch existing resource info and build image
if ($SkipInfra) {
    Write-Host "[2/7] Skipping infra, fetching existing resource info..."
    $AcrLoginServer = az acr show --name $AcrName --query loginServer -o tsv
    Assert-AzSuccess "Failed to get ACR info"
    $ContainerAppFqdn = az containerapp show --name $ContainerAppName --resource-group $ResourceGroup --query "properties.configuration.ingress.fqdn" -o tsv
    Assert-AzSuccess "Failed to get Container App info"
    $ContainerAppUrl = "https://$ContainerAppFqdn"
    $SwaToken = az staticwebapp secrets list --name $SwaName --query "properties.apiKey" -o tsv
    Assert-AzSuccess "Failed to get SWA token"

    Write-Host "[3/7] Building and pushing container image..."
    $ImageTag = git rev-parse --short HEAD
    az acr build --registry $AcrName --image "aviators-agent:$ImageTag" --image "aviators-agent:latest" .
    Assert-AzSuccess "Container image build failed"

    Write-Host "[4/7] Deploying agent to Container Apps..."
    az containerapp update --name $ContainerAppName --resource-group $ResourceGroup --image "${AcrLoginServer}/aviators-agent:${ImageTag}"
    Assert-AzSuccess "Container App update failed"
}

# Build and deploy UI
Write-Host ""
Write-Host "[6/7] Building UI..."
$env:VITE_API_BASE = $ContainerAppUrl
Push-Location ui
npm ci
npm run build
Pop-Location

Write-Host "[7/7] Deploying UI to Static Web Apps..."
if (-not (Get-Command swa -ErrorAction SilentlyContinue)) {
    npm install -g @azure/static-web-apps-cli
}
swa deploy ui/dist --deployment-token $SwaToken --env production

# Done
Write-Host ""
Write-Host "Deployment complete!"
Write-Host "   Agent API:  $ContainerAppUrl"
Write-Host "   Foundry:    ${ContainerAppUrl}/responses"
Write-Host ""
Write-Host "If this is the first deploy, wait ~5 minutes for RBAC propagation."