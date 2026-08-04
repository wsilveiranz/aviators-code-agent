import type { McpBridge } from './mcpBridge.js';
import type { JsonObject, Tool } from './types.js';
import { normalizePacificCalendarDate } from './calendarDate.js';
import { toSafeHttpUrl } from './contentSafety.js';
import { errorMessage } from './types.js';

interface McpContentItem {
  text?: string;
}

interface McpResult {
  content?: McpContentItem[];
  [key: string]: unknown;
}

interface UrlBatchParams {
  urls?: string[];
  inputJson?: string;
  batchSize?: number;
  delayMs?: number;
}

interface ResolveRedirectsParams {
  urls?: string[];
  inputJson?: string;
  delayMs?: number;
}

interface NavigateParams {
  url: string;
}

interface ClickParams {
  element: string;
}

interface TypeParams extends ClickParams {
  text: string;
}

interface TechCommunityBlogParams {
  month: string;
  startDate: string;
  endDate: string;
}

interface ParsedBlogPost {
  title: string;
  url: string;
  dateStr: string | null;
  date: Date | null;
}

function asMcpResult(value: unknown): McpResult {
  return value && typeof value === 'object' ? (value as McpResult) : {};
}

export function snapshotToText(snapshot: unknown): string {
  const result = asMcpResult(snapshot);
  if (Array.isArray(result.content)) {
    return result.content.map((content) => content.text || '').join('\n');
  }
  if (typeof snapshot === 'string') return snapshot;
  return JSON.stringify(snapshot);
}

export function extractFinalPageUrl(navigationResult: unknown): string | null {
  const result = asMcpResult(navigationResult);
  const structuredCandidates = [result.finalUrl, result.pageUrl];
  for (const candidate of structuredCandidates) {
    if (typeof candidate === 'string') {
      const safeUrl = toSafeHttpUrl(candidate);
      if (safeUrl) return safeUrl;
    }
  }

  const pageUrlMatch = snapshotToText(navigationResult).match(
    /^\s*(?:-\s*)?Page URL:\s*(\S+)\s*$/im,
  );
  return pageUrlMatch ? toSafeHttpUrl(pageUrlMatch[1]) : null;
}

export function createScrapeLinkedInTool(
  bridge: McpBridge,
): Tool<UrlBatchParams, unknown> {
  return {
  name: 'scrapeLinkedIn',
  description: 'Scrape LinkedIn activity URLs in batches. Processes up to batchSize (default 3) URLs per call. When hasMore is true in the response, call again with the remainingUrls, then pass each processed batch to createCommunityNews. Persisted output is appended by the extension.',
  parameters: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of LinkedIn activity URLs to scrape'
      },
      inputJson: {
        type: 'string',
        description: '(Legacy) JSON string array of URLs, e.g. \'["url1","url2"]\'. Use "urls" array instead when possible.'
      },
      batchSize: {
        type: 'number',
        description: 'Max URLs to process per call (default 3). Remaining URLs are returned for the next call.',
        default: 3
      },
      delayMs: {
        type: 'number',
        description: 'Delay between requests in milliseconds',
        default: 4000
      }
    },
    required: []
  },
  execute: async ({ urls, inputJson, batchSize = 3, delayMs = 4000 }) => {
    // Resolve URL list from either parameter
    let urlList = urls;
    if (!urlList && inputJson) {
      try {
        urlList = typeof inputJson === 'string' ? JSON.parse(inputJson) : inputJson;
      } catch (error) {
        return {
          success: false,
          error: `Failed to parse inputJson: ${errorMessage(error)}`,
        };
      }
    }

    if (!Array.isArray(urlList) || urlList.length === 0) {
      return { success: false, error: 'No URLs provided. Pass a "urls" array or "inputJson" JSON string.' };
    }

    // Split into current batch and remaining
    const batch = urlList.slice(0, batchSize);
    const remaining = urlList.slice(batchSize);

    console.log(`[scrapeLinkedIn] Processing batch of ${batch.length}/${urlList.length} URLs via Playwright MCP`);
    const results: Array<{
      url: string;
      success: boolean;
      content?: string;
      error?: string;
    }> = [];

    for (let i = 0; i < batch.length; i++) {
      const url = batch[i];
      try {
        console.log(`[scrapeLinkedIn] [${i + 1}/${batch.length}] Navigating to ${url}`);
        await bridge.callTool('playwright', 'browser_navigate', { url });

        // Wait for dynamic content to load
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const snapshot = await bridge.callTool(
          'playwright',
          'browser_snapshot',
        );
        const content = snapshotToText(snapshot);

        results.push({ url, success: true, content });
        console.log(`[scrapeLinkedIn] [${i + 1}/${batch.length}] Got ${content.length} chars`);
      } catch (error) {
        const message = errorMessage(error);
        console.error(`[scrapeLinkedIn] [${i + 1}/${batch.length}] Error: ${message}`);
        results.push({ url, success: false, error: message });
      }

      // Delay between requests to avoid rate limiting
      if (i < batch.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const skippedUrls = results.filter(r => !r.success).map(r => ({ url: r.url, reason: r.error || 'Unknown error' }));
    const hasMore = remaining.length > 0;

    // Build explicit message for the LLM
    const messageParts = [`Batch complete: ${succeeded} of ${batch.length} URLs scraped successfully.`];
    if (skippedUrls.length > 0) {
      messageParts.push(`SKIPPED ${skippedUrls.length} URL(s) - report these to the user:`);
      skippedUrls.forEach((skipped) =>
        messageParts.push(`  - ${skipped.url}: ${skipped.reason}`),
      );
    }
    if (hasMore) {
      messageParts.push(`IMPORTANT: ${remaining.length} URL(s) remaining. You MUST call scrapeLinkedIn again with the remainingUrls array to process them.`);
    }

    if (hasMore) {
      console.log(`[scrapeLinkedIn] Batch complete. ${remaining.length} URLs remaining.`);
    }

    return {
      success: succeeded > 0,
      message: messageParts.join(' '),
      totalUrls: urlList.length,
      batchSize: batch.length,
      succeeded,
      failed: batch.length - succeeded,
      skippedUrls,
      hasMore,
      remainingUrls: hasMore ? remaining : [],
      items: results
    };
  },
  };
}

export function createResolveRedirectsTool(
  bridge: McpBridge,
): Tool<ResolveRedirectsParams, unknown> {
  return {
  name: 'resolveRedirects',
  description: 'Post-process scraped links to resolve redirects and extract final URLs. Uses the Playwright MCP browser to follow redirects.',
  parameters: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of URLs to resolve redirects for'
      },
      inputJson: {
        type: 'string',
        description: '(Legacy) JSON string array of URLs or scraped items with externalLink fields'
      },
      delayMs: {
        type: 'number',
        description: 'Delay between requests in milliseconds',
        default: 1500
      }
    },
    required: []
  },
  execute: async ({ urls, inputJson, delayMs = 1500 }) => {
    // Resolve URL list from either parameter
    let urlList = urls;
    if (!urlList && inputJson) {
      try {
        const parsed = JSON.parse(inputJson) as unknown;
        // Support both plain URL arrays and item objects with externalLink
        if (Array.isArray(parsed)) {
          urlList = parsed
            .map((item) => {
              if (typeof item === 'string') {
                return item;
              }
              if (item && typeof item === 'object') {
                const value = item as {
                  externalLink?: unknown;
                  url?: unknown;
                };
                const url = value.externalLink || value.url;
                return typeof url === 'string' ? url : undefined;
              }
              return undefined;
            })
            .filter((url): url is string => Boolean(url));
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to parse inputJson: ${errorMessage(error)}`,
        };
      }
    }

    if (!Array.isArray(urlList) || urlList.length === 0) {
      return { success: false, error: 'No URLs provided.' };
    }

    console.log(`[resolveRedirects] Resolving ${urlList.length} URLs via Playwright MCP`);
    const results: Array<{
      originalUrl: string;
      finalUrl: string;
      success: boolean;
      error?: string;
    }> = [];

    for (let i = 0; i < urlList.length; i++) {
      const originalUrl = urlList[i];
      try {
        // Navigate — browser follows redirects automatically
        const navResult = await bridge.callTool(
          'playwright',
          'browser_navigate',
          { url: originalUrl },
        );

        const finalUrl = extractFinalPageUrl(navResult) || originalUrl;

        results.push({ originalUrl, finalUrl, success: true });
        console.log(`[resolveRedirects] [${i + 1}/${urlList.length}] ${originalUrl} → ${finalUrl}`);
      } catch (error) {
        const message = errorMessage(error);
        console.error(`[resolveRedirects] [${i + 1}/${urlList.length}] Error: ${message}`);
        results.push({
          originalUrl,
          finalUrl: originalUrl,
          success: false,
          error: message,
        });
      }

      if (i < urlList.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return {
      success: true,
      totalUrls: urlList.length,
      resolved: results.filter(r => r.originalUrl !== r.finalUrl).length,
      items: results
    };
  },
  };
}

async function navigateAndGetContent(
  bridge: McpBridge,
  url: string,
): Promise<unknown> {
  await bridge.callTool('playwright', 'browser_navigate', { url });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return bridge.callTool('playwright', 'browser_snapshot');
}

export function createMcpPlaywrightTool(
  bridge: McpBridge,
): Tool<NavigateParams, unknown> {
  return {
    name: 'playwright_navigate',
    description:
      'Navigate to a URL using Playwright and get the page content. Use this to scrape web pages like the Tech Community blog. Returns the page HTML/text content that you can parse to extract information like blog post titles, dates, and links.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'The URL to navigate to (e.g., "https://techcommunity.microsoft.com/category/azure/blog/integrationsonazureblog")',
        },
      },
      required: ['url'],
    },
    execute: async ({ url }) => {
      try {
        console.log(`[Playwright] Navigating to: ${url}`);
        const result = await navigateAndGetContent(bridge, url);
        console.log(
          `[Playwright] Got content, length: ${JSON.stringify(result).length} chars`,
        );
        return { success: true, url, ...asMcpResult(result) };
      } catch (error) {
        const message = errorMessage(error);
        console.error(`[Playwright] Error: ${message}`);
        return { success: false, error: message };
      }
    },
  };
}

export function createMcpSnapshotTool(
  bridge: McpBridge,
): Tool<Record<string, never>, unknown> {
  return {
    name: 'playwright_snapshot',
    description: 'Get the current page content/snapshot from Playwright MCP',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      try {
        const result = await bridge.callTool('playwright', 'browser_snapshot');
        return { success: true, ...asMcpResult(result) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
  };
}

export function createMcpClickTool(
  bridge: McpBridge,
): Tool<ClickParams, unknown> {
  return {
    name: 'playwright_click',
    description: 'Click on an element in the current page',
    parameters: {
      type: 'object',
      properties: {
        element: {
          type: 'string',
          description: 'Description or ref of the element to click',
        },
      },
      required: ['element'],
    },
    execute: async ({ element }) => {
      try {
        const result = await bridge.callTool('playwright', 'browser_click', {
          element,
        });
        return { success: true, ...asMcpResult(result) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
  };
}

export function createMcpTypeTool(
  bridge: McpBridge,
): Tool<TypeParams, unknown> {
  return {
    name: 'playwright_type',
    description: 'Type text into an element in the current page',
    parameters: {
      type: 'object',
      properties: {
        element: {
          type: 'string',
          description: 'Description or ref of the element to type into',
        },
        text: {
          type: 'string',
          description: 'Text to type',
        },
      },
      required: ['element', 'text'],
    },
    execute: async ({ element, text }) => {
      try {
        const result = await bridge.callTool('playwright', 'browser_type', {
          element,
          text,
        });
        return { success: true, ...asMcpResult(result) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
  };
}

export function parseBlogPosts(content: unknown): ParsedBlogPost[] {
  const result = asMcpResult(content);
  let textContent = '';
  if (Array.isArray(result.content)) {
    textContent = result.content.map((item) => item.text || '').join('\n');
  } else if (typeof content === 'string') {
    textContent = content;
  } else {
    textContent = JSON.stringify(content);
  }

  const lines = textContent.split('\n');
  const urlToPosts = new Map<string, ParsedBlogPost>();
  let currentUrl: string | null = null;
  let currentTitle: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const linkMatch = line.match(/link\s+"([^"]+)"\s+\[ref=/);
    if (linkMatch) {
      currentTitle = linkMatch[1];
    }

    const urlMatch = line.match(
      /\/url:\s*(\/blog\/integrationsonazureblog\/[^\s]+)/,
    );
    if (urlMatch && urlMatch[1].length >= 40) {
      const fullUrl = `https://techcommunity.microsoft.com${urlMatch[1]}`;
      currentUrl = fullUrl;
      if (!urlToPosts.has(fullUrl) && currentTitle) {
        urlToPosts.set(fullUrl, {
          title: currentTitle,
          url: fullUrl,
          dateStr: null,
          date: null,
        });
      }
    }

    const dateMatch = line.match(
      /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})/i,
    );
    if (dateMatch && currentUrl) {
      const post = urlToPosts.get(currentUrl);
      if (post && !post.date) {
        post.dateStr = dateMatch[0];
        const calendarDate = normalizePacificCalendarDate(post.dateStr);
        post.date = calendarDate
          ? new Date(`${calendarDate}T12:00:00-08:00`)
          : null;
      }
    }
  }

  return Array.from(urlToPosts.values());
}

export function filterByDateWindow(
  posts: ParsedBlogPost[],
  startDate: string,
  endDate: string,
): ParsedBlogPost[] {
  const startCalendarDate = normalizePacificCalendarDate(startDate);
  const endCalendarDate = normalizePacificCalendarDate(endDate);
  if (!startCalendarDate || !endCalendarDate) return [];

  return posts.filter((post) => {
    const postCalendarDate = post.dateStr
      ? normalizePacificCalendarDate(post.dateStr)
      : null;
    if (!postCalendarDate) return false;

    const inRange =
      postCalendarDate >= startCalendarDate &&
      postCalendarDate <= endCalendarDate;
    const isNewsletter = post.title.toLowerCase().includes('aviators newsletter');
    return inRange && !isNewsletter;
  });
}

export function createTechCommunityBlogTool(
  bridge: McpBridge,
): Tool<TechCommunityBlogParams, unknown> {
  return {
    name: 'getTechCommunityBlogPosts',
    description: `Fetches blog posts from the Tech Community Integration on Azure blog and filters by date range. 
Returns ONLY posts published within the specified date window.
Use this instead of playwright_navigate when you need blog posts for a specific newsletter month.
The tool automatically excludes "Aviators Newsletter" posts and handles date filtering.`,
    parameters: {
      type: 'object',
      properties: {
        month: {
          type: 'string',
          description: 'The newsletter month (e.g., "February 2026")',
        },
        startDate: {
          type: 'string',
          description:
            'Start date of the window in ISO format (e.g., "2026-01-06")',
        },
        endDate: {
          type: 'string',
          description:
            'End date of the window in ISO format (e.g., "2026-02-01")',
        },
      },
      required: ['month', 'startDate', 'endDate'],
    },
    execute: async ({ month, startDate, endDate }) => {
      try {
        console.log(
          `[TechCommunityBlog] Fetching posts for ${month} (${startDate} to ${endDate})`,
        );

        const url =
          'https://techcommunity.microsoft.com/category/azure/blog/integrationsonazureblog';
        console.log(`[TechCommunityBlog] Navigating to: ${url}`);

        await bridge.callTool('playwright', 'browser_navigate', { url });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const snapshot = await bridge.callTool(
          'playwright',
          'browser_snapshot',
        );

        const allPosts = parseBlogPosts(snapshot);
        console.log(
          `[TechCommunityBlog] Found ${allPosts.length} total posts on page`,
        );

        const filteredPosts = filterByDateWindow(
          allPosts,
          startDate,
          endDate,
        );
        console.log(
          `[TechCommunityBlog] ${filteredPosts.length} posts within date range`,
        );

        if (allPosts.length > 0) {
          console.log('[TechCommunityBlog] Posts found:');
          const matchingUrls = new Set(filteredPosts.map((post) => post.url));
          allPosts.slice(0, 10).forEach((post) => {
            const indicator = post.date
              ? matchingUrls.has(post.url) ? '✓' : '✗'
              : '?';
            console.log(
              `  - "${post.title}" (${post.dateStr || 'no date'}) ${indicator}`,
            );
          });
        }

        return {
          success: true,
          month,
          dateWindow: { start: startDate, end: endDate },
          totalFound: allPosts.length,
          matchingPosts: filteredPosts.length,
          posts: filteredPosts.map((post) => ({
            title: post.title,
            url: post.url,
            date: post.dateStr,
          })),
          message:
            filteredPosts.length > 0
              ? `Found ${filteredPosts.length} posts within ${month} date window. Use playwright_navigate to fetch details for each post URL.`
              : `No posts found within the ${month} date window (${startDate} to ${endDate}). The newsletter may have no Product Group news for this period.`,
        };
      } catch (error) {
        const message = errorMessage(error);
        console.error(`[TechCommunityBlog] Error: ${message}`);
        return {
          success: false,
          error: message,
          message:
            'Failed to fetch blog posts. Try using playwright_navigate directly.',
        };
      }
    },
  };
}

export interface PlaywrightTools {
  scrapeLinkedInTool: Tool<UrlBatchParams, unknown>;
  resolveRedirectsTool: Tool<ResolveRedirectsParams, unknown>;
  mcpPlaywrightTool: Tool<NavigateParams, unknown>;
  mcpSnapshotTool: Tool<Record<string, never>, unknown>;
  mcpClickTool: Tool<ClickParams, unknown>;
  mcpTypeTool: Tool<TypeParams, unknown>;
  techCommunityBlogTool: Tool<TechCommunityBlogParams, unknown>;
}

export function createPlaywrightTools(bridge: McpBridge): PlaywrightTools {
  return {
    scrapeLinkedInTool: createScrapeLinkedInTool(bridge),
    resolveRedirectsTool: createResolveRedirectsTool(bridge),
    mcpPlaywrightTool: createMcpPlaywrightTool(bridge),
    mcpSnapshotTool: createMcpSnapshotTool(bridge),
    mcpClickTool: createMcpClickTool(bridge),
    mcpTypeTool: createMcpTypeTool(bridge),
    techCommunityBlogTool: createTechCommunityBlogTool(bridge),
  };
}
