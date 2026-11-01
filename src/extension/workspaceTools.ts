import * as vscode from "vscode";

const textDecoder = new TextDecoder();
const MAX_READ_BYTES = 256_000;
const MAX_SEARCH_FILE_BYTES = 512_000;
const DEFAULT_EXCLUDE =
  "**/{.git,node_modules,dist,out,build,.playwright-mcp}/**";

export const WORKSPACE_TOOL_NAMES = {
  list: "aviators_listWorkspaceFiles",
  read: "aviators_readWorkspaceFile",
  search: "aviators_searchWorkspaceFiles",
  replace: "aviators_replaceWorkspaceText"
} as const;

export const workspaceLanguageModelChatTools:
  readonly vscode.LanguageModelChatTool[] = [
    {
      name: WORKSPACE_TOOL_NAMES.list,
      description:
        "List files in the open VS Code workspace. Use this to discover newsletter inputs, existing HTML, or supporting files before reading them.",
      inputSchema: {
        type: "object",
        properties: {
          glob: {
            type: "string",
            description: "Workspace glob such as **/*.html or **/*.json.",
            default: "**/*"
          },
          maxResults: {
            type: "number",
            description: "Maximum files to return (default 50, maximum 200).",
            default: 50
          }
        }
      }
    },
    {
      name: WORKSPACE_TOOL_NAMES.read,
      description:
        "Read a UTF-8 text file from the open workspace. Paths returned by listWorkspaceFiles can be used directly.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path or file URI."
          },
          startLine: {
            type: "number",
            description: "Optional 1-based first line."
          },
          endLine: {
            type: "number",
            description: "Optional inclusive 1-based last line."
          }
        },
        required: ["path"]
      }
    },
    {
      name: WORKSPACE_TOOL_NAMES.search,
      description:
        "Search text files in the open workspace for a literal case-insensitive string and return matching lines.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Literal text to search for."
          },
          glob: {
            type: "string",
            description: "Optional file glob, default **/*."
          },
          maxResults: {
            type: "number",
            description: "Maximum matching lines (default 40, maximum 100).",
            default: 40
          }
        },
        required: ["query"]
      }
    },
    {
      name: WORKSPACE_TOOL_NAMES.replace,
      description:
        "Replace exact text in an existing UTF-8 workspace file and save it. Prefer this for small, precise corrections such as changing a URL, name, date, or sentence after reading the file. The old text must match exactly; ambiguous matches are rejected unless replaceAll is explicitly true.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path or file URI."
          },
          oldText: {
            type: "string",
            description:
              "Exact existing text to replace. Include enough surrounding text to make the match unique."
          },
          newText: {
            type: "string",
            description: "Replacement text."
          },
          replaceAll: {
            type: "boolean",
            description:
              "Replace every exact match. Defaults to false and must only be true when every occurrence should change.",
            default: false
          }
        },
        required: ["path", "oldText", "newText"]
      }
    }
  ];

export function isWorkspaceTool(name: string): boolean {
  return Object.values(WORKSPACE_TOOL_NAMES).includes(
    name as (typeof WORKSPACE_TOOL_NAMES)[keyof typeof WORKSPACE_TOOL_NAMES]
  );
}

export async function invokeWorkspaceTool(
  name: string,
  input: unknown,
  token: vscode.CancellationToken
): Promise<vscode.LanguageModelToolResult> {
  const record = asRecord(input);
  let result: unknown;

  if (name === WORKSPACE_TOOL_NAMES.list) {
    result = await listWorkspaceFiles(record, token);
  } else if (name === WORKSPACE_TOOL_NAMES.read) {
    result = await readWorkspaceFile(record, token);
  } else if (name === WORKSPACE_TOOL_NAMES.search) {
    result = await searchWorkspaceFiles(record, token);
  } else if (name === WORKSPACE_TOOL_NAMES.replace) {
    result = await replaceWorkspaceText(record, token);
  } else {
    throw new Error(`Unknown workspace tool "${name}".`);
  }

  async function replaceWorkspaceText(
    input: Record<string, unknown>,
    token: vscode.CancellationToken
  ): Promise<{
    path: string;
    replacements: number;
    saved: true;
  }> {
    const path = readRequiredString(input.path, "path");
    const oldText = readRequiredString(input.oldText, "oldText");
    const newText = readString(input.newText, "newText");
    const replaceAll = input.replaceAll === true;
    if (oldText === newText) {
      throw new Error("Workspace replacement text is unchanged.");
    }
    if (
      oldText.length > MAX_READ_BYTES ||
      newText.length > MAX_READ_BYTES
    ) {
      throw new Error(
        "Workspace replacement text exceeds the 256 KB safety limit."
      );
    }

    const uri = resolveWorkspacePath(path);
    throwIfCancelled(token);
    const document = await vscode.workspace.openTextDocument(uri);
    const content = document.getText();
    const offsets = findExactMatches(content, oldText);
    if (offsets.length === 0) {
      throw new Error(
        `The exact text was not found in workspace file "${path}". Read the current file contents and retry with matching text.`
      );
    }
    if (offsets.length > 1 && !replaceAll) {
      throw new Error(
        `The exact text occurs ${offsets.length} times in workspace file "${path}". Include more surrounding text or explicitly set replaceAll to true.`
      );
    }

    const edit = new vscode.WorkspaceEdit();
    const selectedOffsets = replaceAll ? offsets : offsets.slice(0, 1);
    for (const offset of selectedOffsets) {
      edit.replace(
        uri,
        new vscode.Range(
          document.positionAt(offset),
          document.positionAt(offset + oldText.length)
        ),
        newText
      );
    }

    throwIfCancelled(token);
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error(
        `VS Code rejected the exact text replacement for workspace file "${path}".`
      );
    }
    if (!(await document.save())) {
      throw new Error(
        `The replacement was applied in the editor but workspace file "${path}" could not be saved.`
      );
    }

    return {
      path: vscode.workspace.asRelativePath(uri, true),
      replacements: selectedOffsets.length,
      saved: true
    };
  }

  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))
  ]);
}

async function listWorkspaceFiles(
  input: Record<string, unknown>,
  token: vscode.CancellationToken
): Promise<{ files: string[] }> {
  requireWorkspace();
  throwIfCancelled(token);
  const glob = readOptionalString(input.glob) ?? "**/*";
  const maxResults = clampNumber(input.maxResults, 50, 1, 200);
  const uris = await vscode.workspace.findFiles(
    glob,
    DEFAULT_EXCLUDE,
    maxResults,
    token
  );
  return {
    files: uris.map((uri) => vscode.workspace.asRelativePath(uri, true))
  };
}

async function readWorkspaceFile(
  input: Record<string, unknown>,
  token: vscode.CancellationToken
): Promise<{ path: string; content: string; truncated: boolean }> {
  const path = readRequiredString(input.path, "path");
  const uri = resolveWorkspacePath(path);
  throwIfCancelled(token);
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (bytes.byteLength > MAX_READ_BYTES) {
    throw new Error(
      `Workspace file "${path}" is ${bytes.byteLength} bytes; read a smaller file or narrow the requested content.`
    );
  }
  const text = decodeText(bytes, path);
  const lines = text.split(/\r?\n/);
  const startLine = clampNumber(input.startLine, 1, 1, Math.max(1, lines.length));
  const endLine = clampNumber(
    input.endLine,
    lines.length,
    startLine,
    Math.max(startLine, lines.length)
  );
  return {
    path: vscode.workspace.asRelativePath(uri, true),
    content: lines.slice(startLine - 1, endLine).join("\n"),
    truncated: startLine > 1 || endLine < lines.length
  };
}

async function searchWorkspaceFiles(
  input: Record<string, unknown>,
  token: vscode.CancellationToken
): Promise<{
  query: string;
  matches: Array<{ path: string; line: number; text: string }>;
  truncated: boolean;
}> {
  requireWorkspace();
  const query = readRequiredString(input.query, "query");
  const normalizedQuery = query.toLowerCase();
  const glob = readOptionalString(input.glob) ?? "**/*";
  const maxResults = clampNumber(input.maxResults, 40, 1, 100);
  const files = await vscode.workspace.findFiles(
    glob,
    DEFAULT_EXCLUDE,
    200,
    token
  );
  const matches: Array<{ path: string; line: number; text: string }> = [];

  for (const uri of files) {
    throwIfCancelled(token);
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      continue;
    }
    if (bytes.byteLength > MAX_SEARCH_FILE_BYTES) {
      continue;
    }
    let text: string;
    try {
      text = decodeText(bytes, uri.toString());
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].toLowerCase().includes(normalizedQuery)) {
        matches.push({
          path: vscode.workspace.asRelativePath(uri, true),
          line: index + 1,
          text: lines[index].trim().slice(0, 500)
        });
        if (matches.length >= maxResults) {
          return { query, matches, truncated: true };
        }
      }
    }
  }

  return { query, matches, truncated: false };
}

function resolveWorkspacePath(value: string): vscode.Uri {
  const folders = requireWorkspace();
  let candidate: vscode.Uri | undefined;

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    candidate = vscode.Uri.parse(value);
  } else if (/^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{2}/.test(value)) {
    candidate = vscode.Uri.file(value);
  } else {
    const normalized = value.replace(/\\/g, "/").replace(/^\.?\//, "");
    const matchingFolder = folders.find(
      (folder) =>
        normalized === folder.name ||
        normalized.startsWith(`${folder.name}/`)
    );
    candidate = matchingFolder
      ? vscode.Uri.joinPath(
          matchingFolder.uri,
          normalized.slice(matchingFolder.name.length).replace(/^\//, "")
        )
      : folders.length === 1
        ? vscode.Uri.joinPath(folders[0].uri, normalized)
        : undefined;
  }

  if (!candidate || !vscode.workspace.getWorkspaceFolder(candidate)) {
    throw new Error(
      `Path "${value}" is not inside an open workspace. In a multi-root workspace, prefix the path with the workspace folder name.`
    );
  }
  return candidate;
}

function requireWorkspace(): readonly vscode.WorkspaceFolder[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("Open a workspace folder before using workspace tools.");
  }
  return folders;
}

function decodeText(bytes: Uint8Array, path: string): string {
  const sampleLength = Math.min(bytes.byteLength, 8_192);
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) {
      throw new Error(`Workspace file "${path}" appears to be binary.`);
    }
  }
  return textDecoder.decode(bytes);
}

function readRequiredString(value: unknown, name: string): string {
  const result = readOptionalString(value);
  if (!result) {
    throw new Error(`Workspace tool input "${name}" must be a non-empty string.`);
  }
  return result;
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`Workspace tool input "${name}" must be a string.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function findExactMatches(content: string, search: string): number[] {
  const offsets: number[] = [];
  let offset = 0;
  while (offset <= content.length - search.length) {
    const match = content.indexOf(search, offset);
    if (match < 0) {
      break;
    }
    offsets.push(match);
    offset = match + search.length;
  }
  return offsets;
}

function clampNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const number = typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}
