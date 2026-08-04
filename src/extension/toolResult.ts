export const TOOL_RESULT_TRUNCATION_MARKER =
  "[Tool result truncated to fit the model context. Omitted content is not evidence; do not repeat the identical tool call solely to recover it.]";

export function findExplicitToolFailure(value: unknown): string | undefined {
  return findFailure(value, new WeakSet<object>(), 0);
}

export function serializeToolResultContent(
  content: readonly unknown[]
): string {
  const serialized = content
    .map((part) => serializeToolResultValue(part))
    .filter((part) => part.length > 0);

  return serialized.length > 0
    ? serialized.join("\n")
    : "Tool completed without textual output.";
}

export function truncateSerializedToolResult(
  serialized: string,
  retainedCharacters: number
): string {
  if (retainedCharacters >= serialized.length) {
    return serialized;
  }

  const retained = Math.max(0, retainedCharacters);
  if (retained === 0) {
    return TOOL_RESULT_TRUNCATION_MARKER;
  }

  const headLength = Math.ceil(retained * 0.75);
  const tailLength = retained - headLength;
  const head = serialized.slice(0, headLength);
  const tail =
    tailLength > 0 ? `\n${serialized.slice(-tailLength)}` : "";
  return `${head}\n\n${TOOL_RESULT_TRUNCATION_MARKER}${tail}`;
}

function findFailure(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): string | undefined {
  if (depth > 10 || value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    for (const candidate of jsonCandidates(value)) {
      try {
        const failure = findFailure(
          JSON.parse(candidate) as unknown,
          seen,
          depth + 1
        );
        if (failure) {
          return failure;
        }
      } catch {
        // Tool text commonly contains a display prefix before JSON.
      }
    }
    return undefined;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const failure = findFailure(item, seen, depth + 1);
      if (failure) {
        return failure;
      }
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.success === false) {
    return readFailureDetail(record);
  }

  for (const key of ["value", "text", "content"]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const failure = findFailure(record[key], seen, depth + 1);
      if (failure) {
        return failure;
      }
    }
  }

  return undefined;
}

function jsonCandidates(value: string): string[] {
  const trimmed = value.trim();
  const candidates = [trimmed];
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index > 0);
  if (starts.length > 0) {
    candidates.push(trimmed.slice(Math.min(...starts)));
  }
  return candidates;
}

function readFailureDetail(record: Record<string, unknown>): string {
  for (const key of ["error", "message", "reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "the tool returned success=false";
}

function serializeToolResultValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (typeof value !== "object") {
    return String(value);
  }

  const record = value as Record<string, unknown>;
  if (typeof record.value === "string") {
    return record.value;
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  if (record.data instanceof Uint8Array) {
    return `[binary tool result: ${record.data.byteLength} bytes]`;
  }

  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key: string, item: unknown) => {
        if (typeof item === "bigint") {
          return item.toString();
        }
        if (item instanceof Uint8Array) {
          return `[binary data: ${item.byteLength} bytes]`;
        }
        if (typeof item === "object" && item !== null) {
          if (seen.has(item)) {
            return "[Circular]";
          }
          seen.add(item);
        }
        return item;
      }) ?? String(value)
    );
  } catch {
    return String(value);
  }
}
