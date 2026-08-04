import * as vscode from "vscode";

import type { McpBridge, McpServer } from "../core/mcpBridge.js";
import type { JsonObject } from "../core/types.js";

const TOOL_NAME_PREFIX_SEPARATORS = new Set([".", ":", "/", "_", "-"]);
const textDecoder = new TextDecoder();

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface NormalizedMcpToolResult {
  content: McpTextContent[];
}

export interface LanguageModelToolResultLike {
  readonly content: readonly unknown[];
}

export function resolveLmToolName(
  canonicalName: string,
  availableNames: readonly string[]
): string {
  if (availableNames.includes(canonicalName)) {
    return canonicalName;
  }

  const suffixMatches = availableNames.filter((candidate) =>
    hasPrefixedToolName(candidate, canonicalName)
  );

  if (suffixMatches.length === 1) {
    return suffixMatches[0];
  }

  if (suffixMatches.length > 1) {
    throw new Error(
      `MCP tool name "${canonicalName}" is ambiguous. Matching VS Code tools: ${suffixMatches
        .map((name) => `"${name}"`)
        .join(", ")}.`
    );
  }

  throw new Error(
    `MCP tool "${canonicalName}" is not available in vscode.lm.tools.`
  );
}

export function normalizeLmToolResult(
  result: LanguageModelToolResultLike,
  toolName: string
): NormalizedMcpToolResult {
  const content = result.content
    .map(toolResultPartToText)
    .filter((text): text is string => text !== undefined && text.trim().length > 0)
    .map((text): McpTextContent => ({ type: "text", text }));

  if (content.length === 0) {
    throw new Error(
      `VS Code tool "${toolName}" returned no usable content.`
    );
  }

  return { content };
}

export class LmToolBridge implements McpBridge {
  private readonly resolvedToolNames = new Map<string, string>();

  constructor(
    private readonly toolInvocationToken: vscode.ChatParticipantToolToken,
    private readonly cancellationToken: vscode.CancellationToken,
    private readonly tokenizationOptions?: vscode.LanguageModelToolTokenizationOptions
  ) {}

  async callTool(
    server: McpServer,
    toolName: string,
    args: JsonObject = {}
  ): Promise<NormalizedMcpToolResult> {
    if (this.cancellationToken.isCancellationRequested) {
      throw new vscode.CancellationError();
    }

    const cacheKey = `${server}:${toolName}`;
    let resolvedName = this.resolvedToolNames.get(cacheKey);
    if (!resolvedName) {
      try {
        resolvedName = resolveLmToolName(
          toolName,
          vscode.lm.tools.map((tool) => tool.name)
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Unable to resolve ${server} MCP tool "${toolName}": ${message}`
        );
      }
      this.resolvedToolNames.set(cacheKey, resolvedName);
    }

    const result = await vscode.lm.invokeTool(
      resolvedName,
      {
        input: args,
        toolInvocationToken: this.toolInvocationToken,
        tokenizationOptions: this.tokenizationOptions
      },
      this.cancellationToken
    );

    return normalizeLmToolResult(result, resolvedName);
  }
}

export function createLmToolBridge(
  request: Pick<vscode.ChatRequest, "toolInvocationToken">,
  cancellationToken: vscode.CancellationToken
): McpBridge {
  return new LmToolBridge(request.toolInvocationToken, cancellationToken);
}

function hasPrefixedToolName(
  candidate: string,
  canonicalName: string
): boolean {
  if (
    candidate.length <= canonicalName.length ||
    !candidate.endsWith(canonicalName)
  ) {
    return false;
  }

  const prefixEnd = candidate.length - canonicalName.length;
  return TOOL_NAME_PREFIX_SEPARATORS.has(candidate[prefixEnd - 1]);
}

function toolResultPartToText(part: unknown): string | undefined {
  if (typeof part === "string") {
    return part;
  }

  if (part === null) {
    return "null";
  }

  if (typeof part !== "object") {
    return part === undefined ? undefined : String(part);
  }

  if (isRecord(part)) {
    if (typeof part.text === "string") {
      return part.text;
    }

    if (Object.prototype.hasOwnProperty.call(part, "value")) {
      return unknownValueToText(part.value);
    }

    if (part.data instanceof Uint8Array && typeof part.mimeType === "string") {
      if (isTextualMimeType(part.mimeType)) {
        return textDecoder.decode(part.data);
      }

      return `[${part.mimeType} tool result: ${part.data.byteLength} bytes]`;
    }
  }

  return safeStringify(part);
}

function unknownValueToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value !== "object") {
    return String(value);
  }

  return safeStringify(value);
}

function isTextualMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized.endsWith("+json")
  );
}

function safeStringify(value: object): string {
  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(value, (_key: string, item: unknown) => {
      if (typeof item === "bigint") {
        return item.toString();
      }

      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) {
          return "[Circular]";
        }
        seen.add(item);
      }

      return item;
    });

    if (serialized && serialized !== "{}") {
      return serialized;
    }
  } catch {
    // Fall through to a descriptive representation.
  }

  const constructorName = value.constructor?.name;
  return constructorName && constructorName !== "Object"
    ? `[${constructorName} tool result]`
    : "[Unknown tool result]";
}

function isRecord(value: object): value is Record<string, unknown> {
  return !Array.isArray(value);
}
