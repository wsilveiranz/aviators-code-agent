# Bootstrap script for Aviators Newsletter Agent deployment
# Run once to create the service principal and set GitHub Actions secrets/variables.
#
# Prerequisites:
#   - Azure CLI (az) logged in with permissions to create service principals
#   - GitHub CLI (gh) logged in to the repository
#
# Usage:
#   .\infra\bootstrap.ps1

$ErrorActionPreference = 'Stop'

# ──────────────────────────────────────────────
# Configuration — edit these before running
# ──────────────────────────────────────────────

$SubscriptionName = "Logic Apps Demo"
$ResourceGroup    = "rg-aviators"
$Location         = "australiaeast"
$SpName           = "aviators-gh-deploy"
$GitHubRepo       = "wsilveiranz/aviators-code-agent"

# ──────────────────────────────────────────────
# Resolve subscription ID
# ──────────────────────────────────────────────

Write-Host "🔍 Resolving subscription '$SubscriptionName'..."
$SubscriptionId = az account list --query "[?name=='$SubscriptionName'].id" -o tsv
if (-not $SubscriptionId) {
    Write-Error "Subscription '$SubscriptionName' not found. Run 'az login' first."
    exit 1
}
Write-Host "   Subscription ID: $SubscriptionId"

az account set --subscription $SubscriptionId

# ──────────────────────────────────────────────
# Create resource group (if needed)
# ──────────────────────────────────────────────

Write-Host "📦 Ensuring resource group '$ResourceGroup'..."
az group create --name $ResourceGroup --location $Location --output none 2>$null

# ──────────────────────────────────────────────
# Create service principal
# ──────────────────────────────────────────────

Write-Host "🔑 Creating service principal '$SpName'..."
$SpJson = az ad sp create-for-rbac `
    --name $SpName `
    --role Contributor `
    --scopes "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup" `
    --sdk-auth

Write-Host "   Service principal created."

# ──────────────────────────────────────────────
# Set GitHub Actions secrets
# ──────────────────────────────────────────────

Write-Host "🔒 Setting GitHub Actions secrets..."

$SpJson | gh secret set AZURE_CREDENTIALS --repo $GitHubRepo
Write-Host "   ✅ AZURE_CREDENTIALS set"

gh secret set AZURE_SUBSCRIPTION_ID --repo $GitHubRepo --body $SubscriptionId
Write-Host "   ✅ AZURE_SUBSCRIPTION_ID set"

# ──────────────────────────────────────────────
# Set GitHub Actions variables
# ──────────────────────────────────────────────

Write-Host "📝 Setting GitHub Actions variables..."

gh variable set ACR_NAME           --repo $GitHubRepo --body "acrAviators"
gh variable set CONTAINER_APP_NAME --repo $GitHubRepo --body "ca-aviators-agents"
gh variable set RESOURCE_GROUP     --repo $GitHubRepo --body $ResourceGroup
gh variable set AZURE_LOCATION     --repo $GitHubRepo --body $Location

Write-Host "   ✅ Variables set (ACR_NAME, CONTAINER_APP_NAME, RESOURCE_GROUP, AZURE_LOCATION)"

# ──────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────

Write-Host ""
Write-Host "✅ Bootstrap complete!"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Fill in infra/main.bicepparam with your Azure OpenAI resource ID and MCP credentials"
Write-Host "  2. Trigger the 'Deploy Newsletter Agent' workflow from GitHub Actions"
Write-Host "     (it will provision infra, build, and deploy automatically)"
Write-Host ""
