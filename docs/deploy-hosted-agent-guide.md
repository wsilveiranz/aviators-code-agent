# How to Deploy a Hosted Agent in Azure AI Foundry

> A step-by-step playbook based on real-world deployment experience (Feb 2026).  
> SDK: `azure-ai-agentserver-agentframework==1.0.0b10` · Protocol: `responses` · Runtime: Docker (Python 3.12)

---

## Prerequisites

- **Azure subscription** with access to Azure AI Foundry
- **Azure AI Foundry account + project** already created (eastus2 or supported region)
- **Azure Container Registry (ACR)** provisioned in the same resource group
- **`azd` CLI** installed ([install guide](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/install-azd))
- **`az` CLI** logged in (`az login`)
- **Docker** running locally (for remote builds via `azd`)
- A deployed **chat model** (e.g., gpt-4o, gpt-5.1) in your Foundry project

---

## Step 1 — Scaffold the Project Structure

Create this minimal file structure:

```
your-project/
├── azure.yaml                          # azd deployment manifest
├── src/
│   └── my-agent/
│       ├── agent.yaml                  # Agent config (Foundry schema)
│       ├── main.py                     # Agent entry point
│       ├── requirements.txt            # Python dependencies
│       └── Dockerfile                  # Container definition
```

---

## Step 2 — Write `azure.yaml` (Root)

This tells `azd` how to deploy your agent:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/azure-dev/main/schemas/v1.0/azure.yaml.json

requiredVersions:
    extensions:
        azure.ai.agents: '>=0.1.0-preview'

name: my-agent-project

services:
    my-agent:
        project: src/my-agent           # Path to your agent folder
        host: azure.ai.agent
        language: docker
        docker:
            remoteBuild: true           # Build in ACR, not locally
        config:
            container:
                resources:
                    cpu: "1"
                    memory: 2Gi
                scale:
                    maxReplicas: 3
                    minReplicas: 1
            deployments:
                - model:
                    format: OpenAI
                    name: gpt-5.1       # Your model name
                    version: "2025-11-13"
                  name: gpt-5.1
                  sku:
                    capacity: 10
                    name: GlobalStandard
```

---

## Step 3 — Write `agent.yaml`

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/microsoft/AgentSchema/refs/heads/main/schemas/v1.0/ContainerAgent.yaml

kind: hosted
name: my-agent
description: A brief description of your agent.
metadata:
    authors:
        - Your Name
    tags:
        - Azure AI AgentServer
        - Microsoft Agent Framework
protocols:
    - protocol: responses
environment_variables:
    - name: AZURE_OPENAI_ENDPOINT
      value: ${AZURE_OPENAI_ENDPOINT}       # Injected by Foundry at runtime
    - name: AZURE_OPENAI_CHAT_DEPLOYMENT_NAME
      value: gpt-5.1                        # Must match azure.yaml model name
    - name: AZURE_AI_PROJECT_ENDPOINT
      value: ${AZURE_AI_PROJECT_ENDPOINT}    # Injected by Foundry at runtime
```

> **Important**: Use `kind: hosted` and flat structure — no `template:` wrapper.

---

## Step 4 — Write `Dockerfile`

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY . user_agent/
WORKDIR /app/user_agent

RUN if [ -f requirements.txt ]; then \
        pip install -r requirements.txt; \
    else \
        echo "No requirements.txt found"; \
    fi

EXPOSE 8088

CMD ["python", "main.py"]
```

> **Port 8088** is required — the Foundry hosting infrastructure expects it.

---

## Step 5 — Write `requirements.txt`

```
azure-ai-agentserver-agentframework==1.0.0b10
```

That's the only required package. It transitively pulls in `azure-identity`, `openai`, etc.

---

## Step 6 — Write `main.py`

```python
import os
import sys
import logging
from agent_framework.azure import AzureOpenAIChatClient
from azure.ai.agentserver.agentframework import from_agent_framework, FoundryToolsChatMiddleware
from azure.identity import DefaultAzureCredential

# Route all logs to stdout so they appear in container log stream
logging.basicConfig(
    level=logging.DEBUG,    # Use INFO for production
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
    force=True,
)
logger = logging.getLogger("myagent")

def main():
    logger.info("=== Agent starting ===")

    # Validate required env vars
    for var in ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "AZURE_AI_PROJECT_ENDPOINT"]:
        assert os.environ.get(var), f"{var} must be set"

    # Define tools
    tools = [{"type": "web_search_preview"}]

    # Create client with middleware
    chat_client = AzureOpenAIChatClient(
        credential=DefaultAzureCredential(),
        middleware=FoundryToolsChatMiddleware(tools),
    )

    # Create and run agent
    agent = chat_client.create_agent(
        name="My-Agent",        # ⚠️ NO SPACES — see Gotchas below
        instructions="You are a helpful assistant.",
    )

    from_agent_framework(agent).run()

if __name__ == "__main__":
    main()
```

---

## Step 7 — Set Up RBAC Permissions

The project's **Managed Identity** needs these roles at the **Foundry account** scope:

| Role | Role ID | Why |
|---|---|---|
| **Azure AI User** | `53ca6127-db72-4b80-b1b0-d745d6d5456d` | Grants `Microsoft.CognitiveServices/*` data actions (agents/write, agents/read, etc.) |

> **Azure AI Developer** alone is NOT sufficient — it lacks `AIServices/agents/*` data actions.

### How to assign

If `az role assignment create` is blocked by conditional access policy (common in enterprise tenants), use the ARM REST API:

```powershell
$mgmtToken = (az account get-access-token --resource "https://management.azure.com" --query accessToken -o tsv)

# Create role-body.json:
# {
#   "properties": {
#     "roleDefinitionId": "/subscriptions/<SUB>/providers/Microsoft.Authorization/roleDefinitions/53ca6127-db72-4b80-b1b0-d745d6d5456d",
#     "principalId": "<PROJECT_MI_OBJECT_ID>",
#     "principalType": "ServicePrincipal"
#   }
# }

curl.exe -s -X PUT `
    "https://management.azure.com/<FOUNDRY_ACCOUNT_RESOURCE_ID>/providers/Microsoft.Authorization/roleAssignments/<NEW_GUID>?api-version=2022-04-01" `
    -H "Authorization: Bearer $mgmtToken" `
    -H "Content-Type: application/json" `
    -d "@role-body.json"
```

Allow **~5 minutes** for RBAC propagation after assignment.

---

## Step 8 — Deploy

```powershell
azd deploy my-agent
```

This will:
1. Build the Docker image remotely in ACR
2. Push it to your container registry
3. Create a new agent version in Foundry
4. Start the container

Each deploy creates a new **version number** (v1, v2, v3...).

On success, it prints:
- **Playground URL** — test your agent in the browser
- **Agent endpoint** — API endpoint for programmatic access

---

## Step 9 — Test in Playground

Open the Playground URL from the deploy output. Send a message. If you get a response, you're done.

---

## Step 10 — View Container Logs

```powershell
$token = (az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv)

curl.exe -s `
    "https://<ACCOUNT>.services.ai.azure.com/api/projects/<PROJECT>/agents/<AGENT>/versions/<VERSION>/containers/default:logstream?kind=console&tail=100&api-version=2025-11-15-preview" `
    -H "Authorization: Bearer $token"
```

Replace `<ACCOUNT>`, `<PROJECT>`, `<AGENT>`, and `<VERSION>` with your values.

---

## Adding MCP Tool Connections

### Create the Connection (Portal)

1. Go to **AI Foundry portal** → your project → **Connected resources** (or **Tools**)
2. Click **+ New connection** → choose **MCP Server**
3. Fill in:
   - **Name**: e.g., `my-mcp-server`
   - **Target URL**: e.g., `https://learn.microsoft.com/api/mcp`
   - **Authentication**: `None` for public MCPs, or configure as needed
4. Save — note the full **connection resource ID** (looks like `/subscriptions/.../connections/my-mcp-server`)

### Wire into Code

Add the connection ID as an env var in `agent.yaml`:

```yaml
environment_variables:
    # ... existing vars ...
    - name: MY_MCP_CONNECTION_ID
      value: /subscriptions/.../connections/my-mcp-server
```

Update `main.py` to include the MCP tool:

```python
tools = [{"type": "web_search_preview"}]

# Add MCP connections
mcp_env_vars = ["MY_MCP_CONNECTION_ID"]
for env_var in mcp_env_vars:
    if connection_id := os.environ.get(env_var):
        tools.append({"type": "mcp", "project_connection_id": connection_id})
```

Deploy again: `azd deploy my-agent`

---

## Gotchas & Hard-Won Lessons

### 1. Agent name MUST NOT contain spaces

The `agent_framework` passes `agent.name` as `messages[N].name` to the OpenAI API, which enforces pattern `^[^\s<|\\/>]+$`. **Spaces, angle brackets, pipes, slashes, and backslashes are all rejected.**

- Bad: `"Logic Apps OpsAgent"` → `400 BadRequestError` on tool-call flows
- Good: `"LogicApps-OpsAgent"` or `"MyAgent"`

This only fails on queries that trigger tool calls (creating multi-turn messages). Simple "hi" will work fine, making the bug hard to catch.

### 2. Always log to stdout for container debugging

Default container logging doesn't surface framework-level exceptions. Add this at the top of `main.py`:

```python
logging.basicConfig(level=logging.DEBUG, stream=sys.stdout, force=True)
```

Without this, you'll only see health probe GET requests in the log stream and no error details.

### 3. `azure.yaml` must not have a `template:` wrapper in `agent.yaml`

Use flat structure with `kind: hosted` at root. Wrapping in `template:` causes deployment failures.

### 4. `.env` files must be UTF-8 (not UTF-16)

If your `.env` file is UTF-16 encoded (default for some Windows editors), `python-dotenv` will fail silently. Ensure UTF-8 without BOM.

### 5. `load_dotenv()` — comment out for deployment

`load_dotenv()` is useful for local dev but shouldn't interfere with the env vars injected by the Foundry hosting infrastructure. The SDK already pulls `python-dotenv` transitively, but comment it out (or guard it) for deployed containers.

### 6. Azure AI Developer role is NOT enough

You need **Azure AI User** (which has `Microsoft.CognitiveServices/*` wildcard) at the Foundry account scope. Azure AI Developer lacks `AIServices/agents/*` data actions, resulting in `PermissionDenied` errors.

### 7. RBAC propagation takes ~5 minutes

After assigning roles, wait before deploying. Deploying immediately after role assignment will fail with permission errors.

### 8. `DefaultAzureCredential` doesn't work in local Docker

The container has no credential source (no `az login`, no MI endpoint). Local Docker builds/runs will fail at authentication. This is expected — the agent is designed to run in Foundry's hosting environment where MI is available.

### 9. Application Insights 401 errors are cosmetic

You may see repeated `401 Unauthorized` errors to `applicationinsights.azure.com` in logs. These don't affect agent functionality — the App Insights resource may require Entra ID auth configuration.

### 10. Each `azd deploy` creates a new version

There's no in-place update. Every deploy increments the version number. Update your log stream URL accordingly when debugging.

---

## Quick Reference Commands

```powershell
# Deploy
azd deploy my-agent

# Get Foundry API token
$token = (az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv)

# List all versions
curl.exe -s "https://<ACCOUNT>.services.ai.azure.com/api/projects/<PROJECT>/agents/<AGENT>/versions?api-version=2025-11-15-preview" -H "Authorization: Bearer $token"

# Stream logs (update version number)
curl.exe -s "https://<ACCOUNT>.services.ai.azure.com/api/projects/<PROJECT>/agents/<AGENT>/versions/<VER>/containers/default:logstream?kind=console&tail=100&api-version=2025-11-15-preview" -H "Authorization: Bearer $token"

# ARM role assignment (when az cli is blocked)
$mgmtToken = (az account get-access-token --resource "https://management.azure.com" --query accessToken -o tsv)
curl.exe -s -X PUT "https://management.azure.com/<SCOPE>/providers/Microsoft.Authorization/roleAssignments/<GUID>?api-version=2022-04-01" -H "Authorization: Bearer $mgmtToken" -H "Content-Type: application/json" -d "@role-body.json"
```

---

## Reference Links

- [Foundry Hosted Agent Quickstart](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/quickstarts/quickstart-hosted-agent?view=foundry)
- [Foundry RBAC Permissions](https://aka.ms/FoundryPermissions)
- [Official Sample Repo](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/microsoft-foundry-agent/agent-with-foundry-tools)
- [Agent Schema (agent.yaml)](https://github.com/microsoft/AgentSchema)
