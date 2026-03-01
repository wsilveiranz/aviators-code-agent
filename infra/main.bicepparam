using './main.bicep'

param location = 'australiaeast'
param azureOpenAIEndpoint = 'https://ws-open-ai.cognitiveservices.azure.com/'
param azureOpenAIApiVersion = '2025-01-01-preview'
param azureOpenAIModel = 'gpt-5-2'
param azureOpenAIResourceId = '/subscriptions/80d4fe69-c95b-4dd2-a938-9250f1c8ab03/resourceGroups/WSilveira-Sandbox/providers/Microsoft.CognitiveServices/accounts/ws-open-ai'  // TODO: fill in
param emailMcpEndpoint = 'https://ws-mcp-server-cwc8h2dde3bpa7gx.newzealandnorth-01.azurewebsites.net/api/mcpservers/EmailCompanion/mcp'              // TODO: fill in
param emailMcpApiKey = 'eyJzZSI6IjIwMjYtMDItMTJUMDA6Mzc6MTYuMzY1WiIsInNpZyI6InB5NkEwbXNadGUyMzB4d0lCdWRoZm4xQWl4SVoybnZyc2NzOV9JVVBfR2sifQ'                  // TODO: fill in
param imageTag = 'latest'
param swaSku = 'Free'
