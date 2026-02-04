/**
 * EmailCompanion MCP Client
 * Connects to the EmailCompanion MCP server for email retrieval
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const EMAIL_MCP_ENDPOINT = 'EMAIL_MCP_ENDPOINT_REDACTED';
const EMAIL_MCP_API_KEY = 'EMAIL_MCP_API_KEY_REDACTED';

let emailMcpClient = null;

/**
 * Connect to the EmailCompanion MCP server
 */
export async function connectToEmailMCP(options = {}) {
  if (emailMcpClient) {
    return emailMcpClient;
  }

  const endpoint = options.endpoint || EMAIL_MCP_ENDPOINT;
  const apiKey = options.apiKey || EMAIL_MCP_API_KEY;

  console.log('[EmailMCP] Connecting to EmailCompanion MCP server...');

  // Create Streamable HTTP transport with API key authentication
  const transport = new StreamableHTTPClientTransport(
    new URL(endpoint),
    {
      requestInit: {
        headers: {
          'X-API-Key': apiKey
        }
      }
    }
  );

  // Create MCP client
  emailMcpClient = new Client({
    name: 'aviators-code-agent',
    version: '1.0.0'
  });

  // Connect to the server
  await emailMcpClient.connect(transport);
  console.log('[EmailMCP] Connected to EmailCompanion MCP server');

  return emailMcpClient;
}

/**
 * Disconnect from the EmailCompanion MCP server
 */
export async function disconnectEmailMCP() {
  if (emailMcpClient) {
    await emailMcpClient.close();
    emailMcpClient = null;
    console.log('[EmailMCP] Disconnected from EmailCompanion MCP server');
  }
}

/**
 * List available tools from the EmailCompanion MCP server
 */
export async function listEmailMCPTools() {
  const client = await connectToEmailMCP();
  const result = await client.listTools();
  return result.tools;
}

/**
 * Call a tool on the EmailCompanion MCP server
 * @param {string} toolName - Name of the tool to call
 * @param {object} args - Arguments for the tool
 */
export async function callEmailMCPTool(toolName, args = {}) {
  const client = await connectToEmailMCP();
  const result = await client.callTool({
    name: toolName,
    arguments: args
  });
  return result;
}

/**
 * Get email by subject and optional sender
 * @param {string} subject - Email subject to search for
 * @param {string} from - Optional sender to filter by
 */
export async function getEmail(subject, from = null) {
  try {
    // Map to the actual parameter names expected by the MCP server
    const args = { emailSubject: subject };
    if (from) {
      args.from = from;
    }
    
    console.log(`[EmailMCP] Searching for email with subject: "${subject}", from: "${from || 'any'}"`);
    const result = await callEmailMCPTool('mcp-getemail', args);
    
    // Parse the response
    if (result.content && result.content[0]?.text) {
      const parsed = JSON.parse(result.content[0].text);
      if (parsed.value && parsed.value.length > 0) {
        console.log(`[EmailMCP] Found ${parsed.value.length} email(s)`);
        return { success: true, emails: parsed.value };
      } else {
        console.log('[EmailMCP] No emails found matching criteria');
        return { success: false, error: 'No emails found matching the search criteria' };
      }
    }
    
    return result;
  } catch (error) {
    console.error('[EmailMCP] Error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// MCP tool definition for the agent
export const emailCompanionTool = {
  name: 'getEmailFromMCP',
  description: 'Retrieve email content from EmailCompanion MCP server by subject and optional sender. This is the PRIMARY tool for fetching emails. Use this to fetch the Ace Aviator Q&A email or any other email.',
  parameters: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'Email subject to search for (partial match supported)'
      },
      from: {
        type: 'string',
        description: 'Optional sender email or name to filter by'
      }
    },
    required: ['subject']
  },
  execute: async ({ subject, from }) => {
    try {
      const result = await getEmail(subject, from);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
