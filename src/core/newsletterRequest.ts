const HTML_FILE_NAME_PATTERN = /\b([a-zA-Z0-9][a-zA-Z0-9._-]*\.html)\b/i;

export function isNewsletterTemplateRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    /\b(template|skeleton|scaffold)\b/.test(normalized) ||
    /\b(blank|empty|initialize|initialise)\b[\s\S]{0,40}\bnewsletter\b/.test(
      normalized
    )
  );
}

export function extractRequestedNewsletterFileName(
  message: string
): string | undefined {
  return message.match(HTML_FILE_NAME_PATTERN)?.[1];
}
