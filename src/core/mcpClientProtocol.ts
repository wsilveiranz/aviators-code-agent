export type JsonRpcId = number | string;

export interface McpRoot {
  uri: string;
  name?: string;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponseMessage {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export type McpServerMessage =
  | {
      kind: 'request';
      response: JsonRpcResponseMessage;
    }
  | {
      kind: 'response';
      id: JsonRpcId;
      result?: unknown;
      error?: JsonRpcError;
    }
  | {
      kind: 'notification';
    }
  | {
      kind: 'invalid';
    };

export function createMcpInitializeParams(): {
  protocolVersion: string;
  capabilities: {
    roots: {
      listChanged: boolean;
    };
  };
  clientInfo: {
    name: string;
    version: string;
  };
} {
  return {
    protocolVersion: '2025-03-26',
    capabilities: {
      roots: {
        listChanged: false,
      },
    },
    clientInfo: {
      name: 'aviators-newsletter',
      version: '0.1.0',
    },
  };
}

export function handleMcpServerMessage(
  message: unknown,
  roots: readonly McpRoot[],
): McpServerMessage {
  if (!isRecord(message) || message.jsonrpc !== '2.0') {
    return { kind: 'invalid' };
  }

  if (typeof message.method === 'string') {
    if (!isJsonRpcId(message.id)) {
      return { kind: 'notification' };
    }

    if (message.method === 'roots/list') {
      return {
        kind: 'request',
        response: {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            roots: roots.map((root) => ({ ...root })),
          },
        },
      };
    }

    if (message.method === 'ping') {
      return {
        kind: 'request',
        response: {
          jsonrpc: '2.0',
          id: message.id,
          result: {},
        },
      };
    }

    return {
      kind: 'request',
      response: {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: 'Method not found',
        },
      },
    };
  }

  if (!isJsonRpcId(message.id)) {
    return { kind: 'invalid' };
  }

  const error = parseJsonRpcError(message.error);
  if (message.error !== undefined && !error) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'response',
    id: message.id,
    result: message.result,
    error,
  };
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'number' || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonRpcError(value: unknown): JsonRpcError | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    typeof value.code !== 'number' ||
    typeof value.message !== 'string'
  ) {
    return undefined;
  }
  return {
    code: value.code,
    message: value.message,
    data: value.data,
  };
}
