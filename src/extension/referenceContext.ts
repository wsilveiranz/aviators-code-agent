import * as vscode from "vscode";

const textDecoder = new TextDecoder();
const MAX_REFERENCE_FILES = 6;
const MAX_REFERENCE_BYTES = 64_000;
const MAX_TOTAL_CHARACTERS = 160_000;

export async function buildReferenceContext(
  references: readonly vscode.ChatPromptReference[],
  token: vscode.CancellationToken
): Promise<string> {
  const blocks: string[] = [];
  let totalCharacters = 0;
  let fileCount = 0;

  for (const reference of references) {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }

    const uri =
      reference.value instanceof vscode.Uri
        ? reference.value
        : reference.value instanceof vscode.Location
          ? reference.value.uri
          : undefined;

    if (!uri) {
      if (reference.modelDescription) {
        blocks.push(
          `Reference ${reference.id}: ${reference.modelDescription}`
        );
      }
      continue;
    }
    if (fileCount >= MAX_REFERENCE_FILES) {
      blocks.push("[Additional referenced files omitted.]");
      break;
    }

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      blocks.push(`Referenced file ${uri.toString()} could not be read: ${detail}`);
      continue;
    }
    if (bytes.byteLength > MAX_REFERENCE_BYTES) {
      blocks.push(
        `Referenced file ${uri.toString()} was omitted because it is larger than ${MAX_REFERENCE_BYTES} bytes.`
      );
      continue;
    }
    if (bytes.subarray(0, Math.min(bytes.byteLength, 8_192)).includes(0)) {
      blocks.push(`Referenced file ${uri.toString()} appears to be binary.`);
      continue;
    }

    let content = textDecoder.decode(bytes);
    if (reference.value instanceof vscode.Location) {
      const lines = content.split(/\r?\n/);
      content = lines
        .slice(
          reference.value.range.start.line,
          reference.value.range.end.line + 1
        )
        .join("\n");
    }

    const block = `Referenced file: ${vscode.workspace.asRelativePath(uri, true)}
\`\`\`
${content}
\`\`\``;
    if (totalCharacters + block.length > MAX_TOTAL_CHARACTERS) {
      blocks.push("[Referenced file context truncated to fit the request budget.]");
      break;
    }
    blocks.push(block);
    totalCharacters += block.length;
    fileCount += 1;
  }

  return blocks.length > 0
    ? `\n\n## Explicitly referenced context\n${blocks.join("\n\n")}`
    : "";
}
