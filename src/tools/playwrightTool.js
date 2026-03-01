/**
 * Playwright Tools
 * Tools for scraping LinkedIn activities and processing URLs.
 * Uses the Playwright MCP sidecar (browser_navigate + browser_snapshot).
 */

import { callMCPTool } from './mcpClient.js';

/**
 * Extract text content from an MCP snapshot response
 * @param {object} snapshot
 * @returns {string}
 */
function snapshotToText(snapshot) {
  if (snapshot && snapshot.content && Array.isArray(snapshot.content)) {
    return snapshot.content.map(c => c.text || '').join('\n');
  }
  if (typeof snapshot === 'string') return snapshot;
  return JSON.stringify(snapshot);
}

export const scrapeLinkedInTool = {
  name: 'scrapeLinkedIn',
  description: 'Scrape LinkedIn activity URLs in batches. Processes up to batchSize (default 3) URLs per call. When hasMore is true in the response, call again with the remainingUrls to continue. Append results from each batch to the community section using createCommunityNews with existingHtml.',
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
      } catch (e) {
        return { success: false, error: `Failed to parse inputJson: ${e.message}` };
      }
    }

    if (!Array.isArray(urlList) || urlList.length === 0) {
      return { success: false, error: 'No URLs provided. Pass a "urls" array or "inputJson" JSON string.' };
    }

    // Split into current batch and remaining
    const batch = urlList.slice(0, batchSize);
    const remaining = urlList.slice(batchSize);

    console.log(`[scrapeLinkedIn] Processing batch of ${batch.length}/${urlList.length} URLs via Playwright MCP`);
    const results = [];

    for (let i = 0; i < batch.length; i++) {
      const url = batch[i];
      try {
        console.log(`[scrapeLinkedIn] [${i + 1}/${batch.length}] Navigating to ${url}`);
        await callMCPTool('browser_navigate', { url });

        // Wait for dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 2000));

        const snapshot = await callMCPTool('browser_snapshot');
        const content = snapshotToText(snapshot);

        results.push({ url, success: true, content });
        console.log(`[scrapeLinkedIn] [${i + 1}/${batch.length}] Got ${content.length} chars`);
      } catch (error) {
        console.error(`[scrapeLinkedIn] [${i + 1}/${batch.length}] Error: ${error.message}`);
        results.push({ url, success: false, error: error.message });
      }

      // Delay between requests to avoid rate limiting
      if (i < batch.length - 1 && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const hasMore = remaining.length > 0;

    if (hasMore) {
      console.log(`[scrapeLinkedIn] Batch complete. ${remaining.length} URLs remaining.`);
    }

    return {
      success: succeeded > 0,
      totalUrls: urlList.length,
      batchSize: batch.length,
      succeeded,
      failed: batch.length - succeeded,
      hasMore,
      remainingUrls: hasMore ? remaining : [],
      items: results
    };
  }
};

export const resolveRedirectsTool = {
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
        const parsed = typeof inputJson === 'string' ? JSON.parse(inputJson) : inputJson;
        // Support both plain URL arrays and item objects with externalLink
        if (Array.isArray(parsed)) {
          urlList = parsed.map(item =>
            typeof item === 'string' ? item : (item.externalLink || item.url)
          ).filter(Boolean);
        }
      } catch (e) {
        return { success: false, error: `Failed to parse inputJson: ${e.message}` };
      }
    }

    if (!Array.isArray(urlList) || urlList.length === 0) {
      return { success: false, error: 'No URLs provided.' };
    }

    console.log(`[resolveRedirects] Resolving ${urlList.length} URLs via Playwright MCP`);
    const results = [];

    for (let i = 0; i < urlList.length; i++) {
      const originalUrl = urlList[i];
      try {
        // Navigate — browser follows redirects automatically
        const navResult = await callMCPTool('browser_navigate', { url: originalUrl });

        // Extract final URL from navigation result
        let finalUrl = originalUrl;
        if (navResult && navResult.content && Array.isArray(navResult.content)) {
          const text = navResult.content.map(c => c.text || '').join('\n');
          // MCP navigate typically returns the page title/URL in the response
          const urlMatch = text.match(/https?:\/\/[^\s)>\]"]+/);
          if (urlMatch) finalUrl = urlMatch[0];
        }

        results.push({ originalUrl, finalUrl, success: true });
        console.log(`[resolveRedirects] [${i + 1}/${urlList.length}] ${originalUrl} → ${finalUrl}`);
      } catch (error) {
        console.error(`[resolveRedirects] [${i + 1}/${urlList.length}] Error: ${error.message}`);
        results.push({ originalUrl, finalUrl: originalUrl, success: false, error: error.message });
      }

      if (i < urlList.length - 1 && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return {
      success: true,
      totalUrls: urlList.length,
      resolved: results.filter(r => r.originalUrl !== r.finalUrl).length,
      items: results
    };
  }
};
