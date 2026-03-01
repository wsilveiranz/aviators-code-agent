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
#   .\infra\deploy.ps1 -UploadStorage C:\path\to\storage.json  # Upload LinkedIn storage file

param(
    [switch]$SkipInfra,
    [switch]$InfraOnly,
    [string]$UploadStorage
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
$ProjectRoot = Split-Path -Parent $InfraDir
$BicepFile = Join-Path $InfraDir "main.bicep"
$ParamFile = Join-Path $InfraDir "main.bicepparam"

# Ensure we run from project root (needed for Dockerfile and ui/)
Push-Location $ProjectRoot
try {

# Configuration
$SubscriptionName  = "Logic Apps Demo"
$ResourceGroup     = "rg-aviators"
$Location          = "australiaeast"
$AcrName           = "acraviators"
$ContainerAppName  = "ca-aviators-agents"
$SwaName           = "swa-aviators-ui"
$StorageAccountName = "staviators"
$FileShareName     = "playwright-state"

# Azure OpenAI resource (for RBAC - may be in a different RG/subscription)
$OpenAIResourceId  = "/subscriptions/80d4fe69-c95b-4dd2-a938-9250f1c8ab03/resourceGroups/WSilveira-Sandbox/providers/Microsoft.CognitiveServices/accounts/ws-open-ai"

# Set subscription
Write-Host "[1/8] Setting subscription '$SubscriptionName'..."
az account set --subscription $SubscriptionName
Assert-AzSuccess "Failed to set subscription. Run 'az login' first."

# Handle standalone storage upload
if ($UploadStorage -and $SkipInfra -and -not $InfraOnly) {
    Write-Host "Uploading storage.json to Azure Files..."
    if (-not (Test-Path $UploadStorage)) {
        Write-Error "Storage file not found: $UploadStorage"
        exit 1
    }
    $storageKey = az storage account keys list --account-name $StorageAccountName --resource-group $ResourceGroup --query "[0].value" -o tsv
    Assert-AzSuccess "Failed to get storage account key"
    az storage file upload --account-name $StorageAccountName --account-key $storageKey --share-name $FileShareName --source $UploadStorage --path "storage.json" --output none
    Assert-AzSuccess "Failed to upload storage file"
    Write-Host "   storage.json uploaded to $FileShareName file share"
    Write-Host "   Restart the container app to pick up changes:"
    Write-Host "   az containerapp revision restart -n $ContainerAppName -g $ResourceGroup"
    exit 0
}

# Provision infrastructure (Bicep) unless -SkipInfra
if (-not $SkipInfra) {
    Write-Host "[2/8] Creating resource group '$ResourceGroup'..."
    az group create --name $ResourceGroup --location $Location --output none
    Assert-AzSuccess "Failed to create resource group"

    # Ensure ACR exists before building image
    Write-Host "[3/8] Ensuring container registry '$AcrName' exists..."
    az acr show --name $AcrName --resource-group $ResourceGroup --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
        az acr create --name $AcrName --resource-group $ResourceGroup --location $Location --sku Basic --admin-enabled true --output none
        Assert-AzSuccess "Failed to create container registry"
        Write-Host "   Container registry created"
    }

    # Build and push container image BEFORE Bicep
    Write-Host "[4/8] Building and pushing container image to ACR..."
    $ImageTag = git rev-parse --short HEAD
    az acr build --registry $AcrName --image "aviators-agent:$ImageTag" --image "aviators-agent:latest" .
    Assert-AzSuccess "Container image build failed"

    Write-Host "[5/8] Deploying Bicep template (this may take several minutes)..."
    # Check if this is a redeploy (skip role assignments that already exist)
    $existingApp = az containerapp show --name $ContainerAppName --resource-group $ResourceGroup --query "identity.principalId" -o tsv 2>$null
    $roleParam = ""
    if ($existingApp) {
        $roleParam = "createRoleAssignments=false"
        Write-Host "   Redeploy detected, skipping ACR role assignments"
    }
    $rawOutput = az deployment group create --resource-group $ResourceGroup --template-file $BicepFile --parameters $ParamFile $roleParam --query "properties.outputs" --output json 2>$null
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
    $PrincipalId     = $deployOutput.containerAppPrincipalId.value

    Write-Host "   Infrastructure deployed"
    Write-Host "   Container App: $ContainerAppUrl"
    Write-Host "   Static Web App: $SwaUrl"

    # Assign Cognitive Services OpenAI User role on the OpenAI resource
    # This is done here (not Bicep) because the OpenAI resource may be in a different RG
    Write-Host "[6/8] Ensuring RBAC for Azure OpenAI..."
    $existing = az role assignment list --assignee $PrincipalId --scope $OpenAIResourceId --role "Cognitive Services OpenAI User" --query "length(@)" -o tsv 2>$null
    if ($existing -eq "0" -or -not $existing) {
        az role assignment create --assignee $PrincipalId --role "Cognitive Services OpenAI User" --scope $OpenAIResourceId --output none
        Assert-AzSuccess "Failed to assign OpenAI role"
        Write-Host "   Cognitive Services OpenAI User role assigned"
        Write-Host "   Wait ~5 minutes for RBAC propagation on first deploy"
    } else {
        Write-Host "   Role assignment already exists"
    }

    # Upload storage.json to Azure Files if provided
    if ($UploadStorage) {
        Write-Host "   Uploading storage.json to Azure Files..."
        if (Test-Path $UploadStorage) {
            $storageKey = az storage account keys list --account-name $StorageAccountName --resource-group $ResourceGroup --query "[0].value" -o tsv
            az storage file upload --account-name $StorageAccountName --account-key $storageKey --share-name $FileShareName --source $UploadStorage --path "storage.json" --output none
            Write-Host "   storage.json uploaded"
        } else {
            Write-Host "   WARNING: Storage file not found: $UploadStorage (skipping)"
        }
    }

    if ($InfraOnly) {
        Write-Host ""
        Write-Host "Infra-only deploy complete."
        exit 0
    }
}

# If -SkipInfra, fetch existing resource info and build image
if ($SkipInfra) {
    Write-Host "[2/8] Skipping infra, fetching existing resource info..."
    $AcrLoginServer = az acr show --name $AcrName --query loginServer -o tsv
    Assert-AzSuccess "Failed to get ACR info"
    $ContainerAppFqdn = az containerapp show --name $ContainerAppName --resource-group $ResourceGroup --query "properties.configuration.ingress.fqdn" -o tsv
    Assert-AzSuccess "Failed to get Container App info"
    $ContainerAppUrl = "https://$ContainerAppFqdn"
    $SwaToken = az staticwebapp secrets list --name $SwaName --query "properties.apiKey" -o tsv
    Assert-AzSuccess "Failed to get SWA token"

    Write-Host "[3/8] Building and pushing container image..."
    $ImageTag = git rev-parse --short HEAD
    az acr build --registry $AcrName --image "aviators-agent:$ImageTag" --image "aviators-agent:latest" .
    Assert-AzSuccess "Container image build failed"

    Write-Host "[4/8] Deploying agent to Container Apps..."
    az containerapp update --name $ContainerAppName --resource-group $ResourceGroup --container-name aviators-agent --image "${AcrLoginServer}/aviators-agent:${ImageTag}"
    Assert-AzSuccess "Container App update failed"
}

# Build and deploy UI
Write-Host ""
Write-Host "[7/8] Building UI..."
$env:VITE_API_BASE = $ContainerAppUrl
Push-Location ui
npm ci
npm run build
Pop-Location

Write-Host "[8/8] Deploying UI to Static Web Apps..."
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

} finally {
    Pop-Location
}