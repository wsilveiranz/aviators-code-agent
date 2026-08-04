import type { Skill } from './types.js';

import {
  formatPacificCalendarDate,
  normalizePacificCalendarDate,
} from './calendarDate.js';
import { escapeHtml, toSafeHttpUrl } from './contentSafety.js';
import { computeDateWindow } from './dateWindow.js';

export const SOURCE_URL =
  'https://techcommunity.microsoft.com/category/azure/blog/integrationsonazureblog';

export interface ProductGroupPost {
  title: string;
  link: string;
  publishedAt: string;
  summary: string;
  imageUrl?: string;
  date?: string;
  published?: string;
  excerpt?: string;
  description?: string;
}

export interface ProductGroupParams {
  month: string;
  posts: ProductGroupPost[];
  includeOutsideDateWindow?: boolean;
  dateWindowOverrideReason?: string;
}

export interface ProductGroupResult {
  success: true;
  month: string;
  dateWindow: {
    startPST: string;
    endPST: string;
  };
  sourceUrl: string;
  totalPosts: number;
  filteredCount: number;
  dateWindowOverridden: boolean;
  dateWindowOverrideReason?: string;
  posts: ProductGroupPost[];
  html: string;
}

export function filterPosts(
  posts: ProductGroupPost[],
  startDate: Date,
  endDate: Date,
): ProductGroupPost[] {
  console.log(`[ProductGroup] Filtering ${posts.length} posts for window: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  const startCalendarDate = formatPacificCalendarDate(startDate);
  const endCalendarDate = formatPacificCalendarDate(endDate);
  
  return posts.filter(post => {
    const publishDate = normalizePacificCalendarDate(post.publishedAt);
    const validDate = Boolean(
      publishDate && startCalendarDate && endCalendarDate,
    );
    const inWindow =
      publishDate !== null &&
      startCalendarDate !== null &&
      endCalendarDate !== null &&
      publishDate >= startCalendarDate &&
      publishDate <= endCalendarDate;
    const isNewsletter = /logic\s*apps?\s*aviators?\s*newsletter/i.test(post.title);
    
    console.log(`[ProductGroup]   "${post.title}" - date: ${post.publishedAt}, parsed: ${publishDate || 'INVALID'}, inWindow: ${inWindow}, isNewsletter: ${isNewsletter}`);
    
    // Include if in date window and NOT a newsletter post
    return inWindow && !isNewsletter;
  });
}

export function deduplicatePosts(
  posts: ProductGroupPost[],
): ProductGroupPost[] {
  const seen = new Set<string>();
  return posts.filter(post => {
    const key = post.link.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function selectProductGroupPosts(
  posts: ProductGroupPost[],
  startDate: Date,
  endDate: Date,
  includeOutsideDateWindow = false,
): ProductGroupPost[] {
  const selected = includeOutsideDateWindow
    ? posts.filter(
        (post) =>
          !/logic\s*apps?\s*aviators?\s*newsletter/i.test(post.title),
      )
    : filterPosts(posts, startDate, endDate);
  return deduplicatePosts(selected);
}

export function generateHTML(posts: ProductGroupPost[]): string {
  return posts.map(post => {
    const escapedTitle = escapeHtml(post.title);
    const safeLink = toSafeHttpUrl(post.link);
    const titleHtml = safeLink
      ? `<a href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer">${escapedTitle}</a>`
      : escapedTitle;
    
    return `<h5>${titleHtml}</h5>
<p>${escapeHtml(post.summary)}</p>`;
  }).join('\n');
}

export const productGroupSkill: Skill<
  ProductGroupParams,
  ProductGroupResult
> = {
  name: 'createProductGroupNews',
  description: 'Generate Product Group news section from Tech Community posts. Filters by date window and Logic Apps relevance. Posts should have: title, link, publishedAt (ISO date like "2026-01-28" or "Jan 28, 2026"), summary.',
  parameters: {
    type: 'object',
    properties: {
      month: {
        type: 'string',
        description: 'Month for the newsletter, e.g., "February 2026"'
      },
      posts: {
        type: 'array',
        description: 'Array of post objects with title, link, publishedAt (date string), summary, and optional imageUrl',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Post title' },
            link: { type: 'string', description: 'URL to the post' },
            publishedAt: { type: 'string', description: 'Publication date (e.g., "2026-01-28" or "Jan 28, 2026")' },
            summary: { type: 'string', description: 'Post excerpt/summary' },
            imageUrl: { type: 'string', description: 'Optional image URL' }
          },
          required: ['title', 'link', 'publishedAt']
        }
      },
      includeOutsideDateWindow: {
        type: 'boolean',
        description: 'Default false. Set true only when the user explicitly instructs you to include the supplied posts despite the standard newsletter date window.'
      },
      dateWindowOverrideReason: {
        type: 'string',
        description: 'Required when includeOutsideDateWindow is true. Briefly state the user instruction authorizing the override.'
      }
    },
    required: ['month', 'posts']
  },
  execute: async ({
    month,
    posts,
    includeOutsideDateWindow = false,
    dateWindowOverrideReason,
  }) => {
    console.log(`[ProductGroup] Called with month=${month}, posts=${posts?.length || 0}`);

    const normalizedOverrideReason = dateWindowOverrideReason?.trim();
    if (includeOutsideDateWindow && !normalizedOverrideReason) {
      throw new Error(
        'A dateWindowOverrideReason is required when including posts outside the newsletter date window.',
      );
    }
    
    // Normalize date formats
    const normalizedPosts: ProductGroupPost[] = posts.map(post => {
      let publishedAt = post.publishedAt || post.date || post.published || '';
      
      // Try to parse various date formats
      if (publishedAt) {
        publishedAt =
          normalizePacificCalendarDate(publishedAt) || publishedAt;
      }
      
      return {
        ...post,
        publishedAt,
        summary: post.summary || post.excerpt || post.description || ''
      };
    });

    // Compute date window
    const { startPST, endPST } = computeDateWindow(month);
    const startDate = new Date(startPST);
    const endDate = new Date(endPST);

    // Filter and dedupe
    const uniquePosts = selectProductGroupPosts(
      normalizedPosts,
      startDate,
      endDate,
      includeOutsideDateWindow,
    );
    
    console.log(`[ProductGroup] Total: ${posts.length}, Unique: ${uniquePosts.length}, Date window overridden: ${includeOutsideDateWindow}`);

    // Generate HTML
    const html = generateHTML(uniquePosts);

    return {
      success: true,
      month,
      dateWindow: { startPST, endPST },
      sourceUrl: SOURCE_URL,
      totalPosts: posts.length,
      filteredCount: uniquePosts.length,
      dateWindowOverridden: includeOutsideDateWindow,
      ...(normalizedOverrideReason
        ? { dateWindowOverrideReason: normalizedOverrideReason }
        : {}),
      posts: uniquePosts,
      html: `<h1 id="productnews">News from our product group</h1>
${html}
`
    };
  }
};
