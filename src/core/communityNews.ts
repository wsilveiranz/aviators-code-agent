import type { Skill } from './types.js';

import { escapeHtml, toSafeHttpUrl } from './contentSafety.js';

export interface CommunityItem {
  externalLink?: string;
  COM_ArticleLink?: string;
  title?: string;
  COM_ArticleTitle?: string;
  authorProfile?: string;
  COM_LinkedInAuthorProfile?: string;
  authorName?: string;
  COM_LinkedInAuthorName?: string;
  summary?: string;
  COM_ArticleSummary?: string;
  itemKind?: string;
  COM_ItemKind?: string;
}

export interface CommunityNewsParams {
  items: CommunityItem[];
  hasMore?: boolean;
}

export interface CommunityBatchItem {
  externalLink: string;
  title: string;
  authorProfile?: string;
  authorName: string;
  summary: string;
  itemKind: string;
}

export type CommunityNewsResult =
  | {
      success: false;
      error: string;
      fabricatedNames: Array<string | undefined>;
    }
  | {
      success: true;
      kind: 'communityNewsBatch';
      hasMore: boolean;
      isFinalBatch: boolean;
      totalItems: number;
      validItems: number;
      items: CommunityBatchItem[];
      batchHtml: string;
    };

export interface TrustedCommunityBatch {
  hasMore: boolean;
  items: CommunityBatchItem[];
}

export const COMMUNITY_SECTION_HEADING =
  '<h1 id="communitynews">News from our community</h1>';

export function getItemKind(url: string): string {
  if (/youtube\.com|youtu\.be/i.test(url)) {
    return 'Video';
  }
  return 'Post';
}

export function filterValidItems<T extends CommunityItem>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const url = item.externalLink || item.COM_ArticleLink;
    const safeUrl = toSafeHttpUrl(url);
    if (!safeUrl) return false;
    
    // Dedupe by URL
    const normalizedUrl = safeUrl.toLowerCase().replace(/\/$/, '');
    if (seen.has(normalizedUrl)) return false;
    seen.add(normalizedUrl);
    
    return true;
  });
}

export function generateItemHTML(item: CommunityItem): string {
  const articleLink = item.externalLink || item.COM_ArticleLink;
  const articleTitle = item.title || item.COM_ArticleTitle || 'Untitled';
  const authorProfile = item.authorProfile || item.COM_LinkedInAuthorProfile;
  const authorName = item.authorName || item.COM_LinkedInAuthorName || 'Unknown Author';
  const summary = item.summary || item.COM_ArticleSummary || '';
  const itemKind = item.itemKind || item.COM_ItemKind || getItemKind(articleLink || '');
  const safeArticleLink = toSafeHttpUrl(articleLink);
  const safeAuthorProfile = toSafeHttpUrl(authorProfile);
  const escapedTitle = escapeHtml(articleTitle);
  const escapedAuthor = escapeHtml(authorName);
  const titleHtml = safeArticleLink
    ? `<a href="${escapeHtml(safeArticleLink)}" target="_blank" rel="noopener noreferrer">${escapedTitle}</a>`
    : escapedTitle;
  const authorHtml = safeAuthorProfile
    ? `<a href="${escapeHtml(safeAuthorProfile)}" target="_blank" rel="noopener nofollow noreferrer"><em>${escapedAuthor}</em></a>`
    : `<em>${escapedAuthor}</em>`;

  return `<h5>${titleHtml}</h5>
<p>${escapeHtml(itemKind)} by ${authorHtml}</p>
<p>${escapeHtml(summary)}</p>`;
}

export function generateBatchHTML(items: CommunityItem[]): string {
  return filterValidItems(items).map(generateItemHTML).join('\n');
}

export function generateHTML(items: CommunityItem[]): string {
  const itemsHtml = generateBatchHTML(items);
  return itemsHtml
    ? `${COMMUNITY_SECTION_HEADING}\n${itemsHtml}`
    : COMMUNITY_SECTION_HEADING;
}

export function mergeCommunitySection(
  existingSectionHtml: string,
  items: CommunityItem[],
): string {
  const existingBody = getExistingCommunityBody(existingSectionHtml);
  const batchHtml = generateBatchHTML(items);
  return [COMMUNITY_SECTION_HEADING, existingBody, batchHtml]
    .filter(Boolean)
    .join('\n');
}

export function findCommunityNewsBatchResult(
  value: unknown,
): TrustedCommunityBatch | undefined {
  return findCommunityBatch(value, new WeakSet<object>(), 0);
}

export const communityNewsSkill: Skill<
  CommunityNewsParams,
  CommunityNewsResult
> = {
  name: 'createCommunityNews',
  description: 'Build one escaped Community News batch from processed LinkedIn activity data. REQUIRES actual scraped data from scrapeLinkedIn - do NOT pass fabricated data or prior newsletter HTML. In an Aviators participant generation, the extension replaces stale Community output with the first batch and accumulates later batches, including trusted cross-request resumes.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        description: 'Array of community items with externalLink, title, authorProfile, authorName, and summary. Data MUST come from scrapeLinkedIn results.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            externalLink: { type: 'string', description: 'URL to the article' },
            title: { type: 'string', description: 'Article title' },
            authorProfile: { type: 'string', description: 'LinkedIn profile URL of the author' },
            authorName: { type: 'string', description: 'Name of the author' },
            summary: { type: 'string', description: '80-100 word summary of the article' },
            itemKind: { type: 'string', description: 'Type of content: Post or Video' }
          }
        }
      },
      hasMore: {
        type: 'boolean',
        description: 'Set to true if there are more URL batches to process after this one. When false or omitted, this is the final batch.',
        default: false
      }
    },
    required: ['items']
  },
  execute: async (params) => {
    const unexpectedParameters = Object.keys(params as object).filter(
      key => key !== 'items' && key !== 'hasMore',
    );
    if (unexpectedParameters.length > 0) {
      return {
        success: false,
        error: `Unsupported Community News parameter(s): ${unexpectedParameters.join(', ')}. Pass only items and hasMore; prior newsletter HTML is not accepted.`,
        fabricatedNames: [],
      };
    }

    const { items, hasMore = false } = params;

    // Validate items to detect fabrication
    const FAKE_NAMES = ['john doe', 'jane doe', 'jane smith', 'john smith', 'unknown author', 'example author'];
    const fabricatedItems = items.filter(item => {
      const name = (
        item.authorName ||
        item.COM_LinkedInAuthorName ||
        ''
      ).toLowerCase();
      return FAKE_NAMES.includes(name);
    });
    
    if (fabricatedItems.length > 0) {
      console.log(`[CommunityNews] REJECTED: ${fabricatedItems.length} items have fabricated author names`);
      return {
        success: false,
        error: 'Fabricated data detected. You must call scrapeLinkedIn first to get real author data.',
        fabricatedNames: fabricatedItems.map(
          item => item.authorName || item.COM_LinkedInAuthorName,
        ),
      };
    }
    
    const validItems = filterValidItems(items);
    const normalizedItems = validItems.map(normalizeCommunityItem);
    console.log(
      `[CommunityNews] Created escaped batch with ${normalizedItems.length} items (${hasMore ? 'more batches remain' : 'final batch'})`,
    );

    return {
      success: true,
      kind: 'communityNewsBatch',
      hasMore,
      isFinalBatch: !hasMore,
      totalItems: items.length,
      validItems: normalizedItems.length,
      items: normalizedItems,
      batchHtml: normalizedItems.map(generateItemHTML).join('\n'),
    };
  }
};

function normalizeCommunityItem(item: CommunityItem): CommunityBatchItem {
  const externalLink = toSafeHttpUrl(
    item.externalLink || item.COM_ArticleLink,
  ) as string;
  const authorProfile = toSafeHttpUrl(
    item.authorProfile || item.COM_LinkedInAuthorProfile,
  );

  return {
    externalLink,
    title: item.title || item.COM_ArticleTitle || 'Untitled',
    ...(authorProfile ? { authorProfile } : {}),
    authorName:
      item.authorName ||
      item.COM_LinkedInAuthorName ||
      'Unknown Author',
    summary: item.summary || item.COM_ArticleSummary || '',
    itemKind:
      item.itemKind ||
      item.COM_ItemKind ||
      getItemKind(externalLink),
  };
}

function getExistingCommunityBody(existingSectionHtml: string): string {
  const trimmed = existingSectionHtml.trim();
  if (!trimmed) {
    return '';
  }

  const headingPattern =
    /<h1\b[^>]*\bid\s*=\s*(["'])communitynews\1[^>]*>[\s\S]*?<\/h1>/gi;
  if (!headingPattern.test(trimmed)) {
    throw new Error(
      'Existing Community section is not recognizable and cannot be safely appended.',
    );
  }

  const withoutHeadings = trimmed.replace(
    /<h1\b[^>]*\bid\s*=\s*(["'])communitynews\1[^>]*>[\s\S]*?<\/h1>/gi,
    '',
  );
  return withoutHeadings
    .replace(
      /<p>\s*<em>\s*&lt;TODO:\s*Generate Community section&gt;\s*<\/em>\s*<\/p>/gi,
      '',
    )
    .trim();
}

function findCommunityBatch(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): TrustedCommunityBatch | undefined {
  if (depth > 8 || value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    for (const candidate of jsonCandidates(value)) {
      try {
        const batch = findCommunityBatch(
          JSON.parse(candidate) as unknown,
          seen,
          depth + 1,
        );
        if (batch) {
          return batch;
        }
      } catch {
        // Language-model tool text includes a display prefix before JSON.
      }
    }
    return undefined;
  }

  if (typeof value !== 'object' || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const batch = findCommunityBatch(item, seen, depth + 1);
      if (batch) {
        return batch;
      }
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    record.success === true &&
    record.kind === 'communityNewsBatch' &&
    typeof record.hasMore === 'boolean' &&
    record.isFinalBatch === !record.hasMore &&
    typeof record.batchHtml === 'string' &&
    Array.isArray(record.items)
  ) {
    const items = record.items.map(readCommunityBatchItem);
    if (items.every((item): item is CommunityBatchItem => item !== undefined)) {
      return { hasMore: record.hasMore, items };
    }
  }

  for (const key of ['value', 'text', 'content']) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const batch = findCommunityBatch(record[key], seen, depth + 1);
      if (batch) {
        return batch;
      }
    }
  }

  return undefined;
}

function readCommunityBatchItem(value: unknown): CommunityBatchItem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const item = value as Record<string, unknown>;
  const externalLink =
    typeof item.externalLink === 'string'
      ? toSafeHttpUrl(item.externalLink)
      : null;
  if (
    !externalLink ||
    typeof item.title !== 'string' ||
    typeof item.authorName !== 'string' ||
    typeof item.summary !== 'string' ||
    typeof item.itemKind !== 'string'
  ) {
    return undefined;
  }

  const authorProfile =
    typeof item.authorProfile === 'string'
      ? toSafeHttpUrl(item.authorProfile)
      : null;
  return {
    externalLink,
    title: item.title,
    ...(authorProfile ? { authorProfile } : {}),
    authorName: item.authorName,
    summary: item.summary,
    itemKind: item.itemKind,
  };
}

function jsonCandidates(value: string): string[] {
  const trimmed = value.trim();
  const candidates = [trimmed];
  const objectStart = trimmed.indexOf('{');
  if (objectStart > 0) {
    candidates.push(trimmed.slice(objectStart));
  }
  return candidates;
}
