using './main.bicep'

param location = 'australiaeast'
param azureOpenAIEndpoint = 'https://ws-open-ai.cognitiveservices.azure.com/'
param azureOpenAIApiVersion = '2025-01-01-preview'
param azureOpenAIModel = 'gpt-5-2'
param azureOpenAIResourceId = '<AZURE_OPENAI_RESOURCE_ID>'  // TODO: fill in
param emailMcpEndpoint = '<EMAIL_MCP_ENDPOINT>'              // TODO: fill in
param emailMcpApiKey = '<EMAIL_MCP_API_KEY>'                  // TODO: fill in
param imageTag = 'latest'
param swaSku = 'Free'
