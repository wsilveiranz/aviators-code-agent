/**
 * Email Tool
 * Retrieve email by subject and optional sender (placeholder - deprecated, use getEmailFromMCP instead)
 */

export const emailTool = {
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
  execute: async ({ subject, from }) => {
    return {
      success: false,
      message: 'This tool is deprecated. Use getEmailFromMCP instead.',
      hint: 'Call getEmailFromMCP with subject and optional from parameters.'
    };
  }
};
