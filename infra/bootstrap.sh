#!/usr/bin/env bash
# Bootstrap script for Aviators Newsletter Agent deployment
# Run once to create the service principal and set GitHub Actions secrets/variables.
#
# Prerequisites:
#   - Azure CLI (az) logged in with permissions to create service principals
#   - GitHub CLI (gh) logged in to the repository
#   - jq installed
#
# Usage:
#   chmod +x infra/bootstrap.sh
#   ./infra/bootstrap.sh

set -euo pipefail

# ──────────────────────────────────────────────
# Configuration — edit these before running
# ──────────────────────────────────────────────

SUBSCRIPTION_NAME="Logic Apps Demo"
RESOURCE_GROUP="rg-aviators"
LOCATION="australiaeast"
SP_NAME="aviators-gh-deploy"
GITHUB_REPO="wsilveiranz/aviators-code-agent"

# ──────────────────────────────────────────────
# Resolve subscription ID
# ──────────────────────────────────────────────

echo "🔍 Resolving subscription '${SUBSCRIPTION_NAME}'..."
SUBSCRIPTION_ID=$(az account list --query "[?name=='${SUBSCRIPTION_NAME}'].id" -o tsv)
if [ -z "$SUBSCRIPTION_ID" ]; then
  echo "❌ Subscription '${SUBSCRIPTION_NAME}' not found. Run 'az login' first."
  exit 1
fi
echo "   Subscription ID: ${SUBSCRIPTION_ID}"

az account set --subscription "$SUBSCRIPTION_ID"

# ──────────────────────────────────────────────
# Create resource group (if needed)
# ──────────────────────────────────────────────

echo "📦 Ensuring resource group '${RESOURCE_GROUP}'..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none 2>/dev/null || true

# ──────────────────────────────────────────────
# Create service principal
# ──────────────────────────────────────────────

echo "🔑 Creating service principal '${SP_NAME}'..."
SP_JSON=$(az ad sp create-for-rbac \
  --name "$SP_NAME" \
  --role Contributor \
  --scopes "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}" \
  --sdk-auth)

echo "   Service principal created."

# ──────────────────────────────────────────────
# Set GitHub Actions secrets
# ──────────────────────────────────────────────

echo "🔒 Setting GitHub Actions secrets..."

echo "$SP_JSON" | gh secret set AZURE_CREDENTIALS --repo "$GITHUB_REPO"
echo "   ✅ AZURE_CREDENTIALS set"

gh secret set AZURE_SUBSCRIPTION_ID --repo "$GITHUB_REPO" --body "$SUBSCRIPTION_ID"
echo "   ✅ AZURE_SUBSCRIPTION_ID set"

# ──────────────────────────────────────────────
# Set GitHub Actions variables
# ──────────────────────────────────────────────

echo "📝 Setting GitHub Actions variables..."

gh variable set ACR_NAME           --repo "$GITHUB_REPO" --body "acrAviators"
gh variable set CONTAINER_APP_NAME --repo "$GITHUB_REPO" --body "ca-aviators-agents"
gh variable set RESOURCE_GROUP     --repo "$GITHUB_REPO" --body "$RESOURCE_GROUP"
gh variable set AZURE_LOCATION     --repo "$GITHUB_REPO" --body "$LOCATION"

echo "   ✅ Variables set (ACR_NAME, CONTAINER_APP_NAME, RESOURCE_GROUP, AZURE_LOCATION)"

# ──────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────

echo ""
echo "✅ Bootstrap complete!"
echo ""
echo "Next steps:"
echo "  1. Fill in infra/main.bicepparam with your Azure OpenAI resource ID and MCP credentials"
echo "  2. Trigger the 'Deploy Newsletter Agent' workflow from GitHub Actions"
echo "     (it will provision infra, build, and deploy automatically)"
echo ""
