import type { McpBridge } from './mcpBridge.js';
import type { Tool } from './types.js';
import { errorMessage } from './types.js';

export interface EmailParams {
  subject: string;
  from?: string;
}

interface McpEmailResult {
  content?: Array<{ text?: string }>;
  [key: string]: unknown;
}

interface EmailSearchResponse {
  value?: unknown[];
}

function asMcpEmailResult(value: unknown): McpEmailResult {
  return value && typeof value === 'object'
    ? (value as McpEmailResult)
    : {};
}

export const emailTool: Tool<EmailParams, unknown> = {
  name: 'getEmail_deprecated',
  description: 'DEPRECATED - Do not use. Use getEmailFromMCP instead to retrieve emails via the EmailCompanion MCP server.',
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
  execute: async () => {
    return {
      success: false,
      message: 'This tool is deprecated. Use getEmailFromMCP instead.',
      hint: 'Call getEmailFromMCP with subject and optional from parameters.'
    };
  }
};

export async function getEmail(
  bridge: McpBridge,
  subject: string,
  from?: string,
): Promise<unknown> {
  try {
    const args: { emailSubject: string; from?: string } = {
      emailSubject: subject,
    };
    if (from) {
      args.from = from;
    }

    console.log(
      `[EmailMCP] Searching for email with subject: "${subject}", from: "${from || 'any'}"`,
    );
    const rawResult = await bridge.callTool('email', 'mcp-getemail', args);
    const result = asMcpEmailResult(rawResult);

    if (result.content?.[0]?.text) {
      const parsed = JSON.parse(result.content[0].text) as EmailSearchResponse;
      if (parsed.value && parsed.value.length > 0) {
        console.log(`[EmailMCP] Found ${parsed.value.length} email(s)`);
        return { success: true, emails: parsed.value };
      }

      console.log('[EmailMCP] No emails found matching criteria');
      return {
        success: false,
        error: 'No emails found matching the search criteria',
      };
    }

    return rawResult;
  } catch (error) {
    const message = errorMessage(error);
    console.error('[EmailMCP] Error:', message);
    return {
      success: false,
      error: message,
    };
  }
}

export function createEmailCompanionTool(
  bridge: McpBridge,
): Tool<EmailParams, unknown> {
  return {
    name: 'getEmailFromMCP',
    description:
      'Retrieve email content from EmailCompanion MCP server by subject and optional sender. This is the PRIMARY tool for fetching emails. Use this to fetch the Ace Aviator Q&A email or any other email.',
    parameters: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'Email subject to search for (partial match supported)',
        },
        from: {
          type: 'string',
          description: 'Optional sender email or name to filter by',
        },
      },
      required: ['subject'],
    },
    execute: async ({ subject, from }) => {
      try {
        const result = await getEmail(bridge, subject, from);
        return { success: true, ...asMcpEmailResult(result) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
  };
}
