// Main Bicep template for Aviators Newsletter Agent deployment
// Deploys: ACR, Container Apps Environment, Container App, Static Web App, role assignments

targetScope = 'resourceGroup'

@description('Azure region for all resources')
param location string = 'australiaeast'

@description('Azure OpenAI endpoint URL')
param azureOpenAIEndpoint string

@description('Azure OpenAI API version')
param azureOpenAIApiVersion string = '2025-01-01-preview'

@description('Azure OpenAI model deployment name')
param azureOpenAIModel string = 'gpt-5-2'

@description('Azure OpenAI resource ID (for future use with scoped role assignment)')
#disable-next-line no-unused-params
param azureOpenAIResourceId string

@description('EmailCompanion MCP endpoint URL')
@secure()
param emailMcpEndpoint string

@description('EmailCompanion MCP API key')
@secure()
param emailMcpApiKey string

@description('Container image tag')
param imageTag string = 'latest'

@description('Static Web App SKU')
@allowed(['Free', 'Standard'])
param swaSku string = 'Free'

// ──────────────────────────────────────────────
// Azure Container Registry
// ──────────────────────────────────────────────

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acraviators'
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
  }
}

// ──────────────────────────────────────────────
// Log Analytics Workspace (required by Container Apps)
// ──────────────────────────────────────────────

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-aviators'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// ──────────────────────────────────────────────
// Application Insights (connected to Log Analytics)
// ──────────────────────────────────────────────

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'ai-aviators'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ──────────────────────────────────────────────
// Storage Account (Azure Files for shared config)
// ──────────────────────────────────────────────

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'staviators'
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: 'playwright-state'
  properties: {
    shareQuota: 1
  }
}

// ──────────────────────────────────────────────
// Container Apps Environment
// ──────────────────────────────────────────────

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-aviators'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource caeStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: cae
  name: 'playwright-state'
  properties: {
    azureFile: {
      accountName: storageAccount.name
      accountKey: storageAccount.listKeys().keys[0].value
      shareName: fileShare.name
      accessMode: 'ReadOnly'
    }
  }
}

// ──────────────────────────────────────────────
// Container App (Agent + API)
// ──────────────────────────────────────────────

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-aviators-agents'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3001
        transport: 'http'
        corsPolicy: {
          allowedOrigins: [
            'https://${staticWebApp.properties.defaultHostname}'
          ]
          allowedMethods: ['GET', 'POST', 'DELETE', 'OPTIONS']
          allowedHeaders: ['*']
        }
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acr.listCredentials().passwords[0].value
        }
        {
          name: 'email-mcp-endpoint'
          value: emailMcpEndpoint
        }
        {
          name: 'email-mcp-api-key'
          value: emailMcpApiKey
        }
      ]
    }
    template: {
      volumes: [
        {
          name: 'playwright-state'
          storageName: caeStorage.name
          storageType: 'AzureFile'
        }
      ]
      containers: [
        {
          name: 'aviators-agent'
          image: '${acr.properties.loginServer}/aviators-agent:${imageTag}'
          resources: {
            cpu: json('1')
            memory: '2Gi'
          }
          env: [
            { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAIEndpoint }
            { name: 'AZURE_OPENAI_API_VERSION', value: azureOpenAIApiVersion }
            { name: 'AZURE_OPENAI_MODEL', value: azureOpenAIModel }
            { name: 'EMAIL_MCP_ENDPOINT', secretRef: 'email-mcp-endpoint' }
            { name: 'EMAIL_MCP_API_KEY', secretRef: 'email-mcp-api-key' }
            { name: 'ALLOWED_ORIGINS', value: 'https://${staticWebApp.properties.defaultHostname}' }
            { name: 'PLAYWRIGHT_MCP_URL', value: 'http://localhost:8080' }
            { name: 'PLAYWRIGHT_STORAGE_PATH', value: '/mnt/playwright-state/storage.json' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
          volumeMounts: [
            {
              volumeName: 'playwright-state'
              mountPath: '/mnt/playwright-state'
            }
          ]
        }
        {
          name: 'playwright-mcp'
          image: 'mcr.microsoft.com/playwright/mcp:latest'
          args: [
            '--port'
            '8080'
            '--host'
            '0.0.0.0'
            '--headless'
            '--storage-state'
            '/mnt/playwright-state/storage.json'
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          volumeMounts: [
            {
              volumeName: 'playwright-state'
              mountPath: '/mnt/playwright-state'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
      }
    }
  }
}

@description('Azure region for Static Web App (limited availability)')
param swaLocation string = 'eastasia'

// ──────────────────────────────────────────────
// Static Web App (UI)
// ──────────────────────────────────────────────

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'swa-aviators-ui'
  location: swaLocation
  sku: {
    name: swaSku
  }
  properties: {}
}

@description('Skip role assignments if they already exist (set to false on first deploy)')
param createRoleAssignments bool = true

// ──────────────────────────────────────────────
// Role Assignment: Container App MI → ACR Pull
// ──────────────────────────────────────────────

// ACR Pull role for Container App
var acrPullRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createRoleAssignments) {
  name: guid(resourceGroup().id, containerApp.id, acrPullRole)
  scope: acr
  properties: {
    roleDefinitionId: acrPullRole
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Note: The Cognitive Services OpenAI User role assignment is handled by
// the deploy script (az role assignment create) because the OpenAI resource
// may be in a different resource group/subscription.

// ──────────────────────────────────────────────
// Outputs
// ──────────────────────────────────────────────

output acrLoginServer string = acr.properties.loginServer
output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
#disable-next-line outputs-should-not-contain-secrets
output staticWebAppDeploymentToken string = staticWebApp.listSecrets().properties.apiKey
output containerAppPrincipalId string = containerApp.identity.principalId
output appInsightsConnectionString string = appInsights.properties.ConnectionString
