/**
 * MCP Client for Playwright
 * Connects to the Playwright MCP server for web scraping capabilities
 * Supports stdio transport (local dev) and SSE transport (deployed with sidecar)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

const PLAYWRIGHT_MCP_PATH = process.env.PLAYWRIGHT_MCP_PATH || 'C:\\dev\\playwright-mcp\\packages\\playwright-mcp\\cli.js';
const STORAGE_PATH = process.env.PLAYWRIGHT_STORAGE_PATH || 'C:\\dev\\aviator-newsletter-agent\\.github\\tools\\playwright-login\\storage.json';
const LOGIN_SCRIPT_PATH = process.env.PLAYWRIGHT_LOGIN_SCRIPT || 'C:\\dev\\aviator-newsletter-agent\\.github\\tools\\playwright-login\\login-linkedin.js';
const PLAYWRIGHT_MCP_URL = process.env.PLAYWRIGHT_MCP_URL; // e.g. http://localhost:8080

let mcpClient = null;
let mcpTransport = null;

/**
 * Check if storage.json exists and is valid
 */
export function isStorageValid(storagePath = STORAGE_PATH) {
  try {
    if (!fs.existsSync(storagePath)) {
      return { valid: false, reason: 'Storage file does not exist' };
    }
    
    const content = fs.readFileSync(storagePath, 'utf-8');
    const state = JSON.parse(content);
    
    // Check if it has cookies
    if (!state.cookies || state.cookies.length === 0) {
      return { valid: false, reason: 'Storage file has no cookies' };
    }
    
    // Check if LinkedIn cookies exist
    const linkedInCookies = state.cookies.filter(c => c.domain && c.domain.includes('linkedin'));
    if (linkedInCookies.length === 0) {
      return { valid: false, reason: 'No LinkedIn cookies found' };
    }
    
    // Check if cookies are expired
    const now = Date.now() / 1000;
    const validCookies = linkedInCookies.filter(c => !c.expires || c.expires > now);
    if (validCookies.length === 0) {
      return { valid: false, reason: 'LinkedIn cookies have expired' };
    }
    
    return { valid: true, cookieCount: linkedInCookies.length };
  } catch (err) {
    return { valid: false, reason: `Error reading storage: ${err.message}` };
  }
}

/**
 * Run the LinkedIn login script to create storage.json
 */
export async function runLinkedInLogin(storagePath = STORAGE_PATH) {
  return new Promise((resolve, reject) => {
    console.log('[MCP] Starting LinkedIn login...');
    console.log('[MCP] A browser window will open. Please log in to LinkedIn.');
    console.log('[MCP] After logging in, press Enter in this terminal to save the session.');
    
    const loginDir = path.dirname(LOGIN_SCRIPT_PATH);
    
    const proc = spawn('node', [LOGIN_SCRIPT_PATH], {
      cwd: loginDir,
      stdio: ['inherit', 'inherit', 'inherit']
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[MCP] LinkedIn login completed successfully.');
        resolve({ success: true, storagePath });
      } else {
        reject(new Error(`Login process exited with code ${code}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(new Error(`Failed to start login process: ${err.message}`));
    });
  });
}

/**
 * Start the Playwright MCP server and connect to it
 */
export async function connectToPlaywrightMCP(options = {}) {
  if (mcpClient) {
    return mcpClient;
  }

  // When PLAYWRIGHT_MCP_URL is set, connect via SSE (deployed sidecar)
  if (PLAYWRIGHT_MCP_URL) {
    console.log(`[MCP] Connecting to Playwright MCP via SSE at ${PLAYWRIGHT_MCP_URL}...`);

    // In deployed mode, check if storage.json is mounted
    const storageCheck = isStorageValid(STORAGE_PATH);
    if (!storageCheck.valid) {
      console.log(`[MCP] Storage check: ${storageCheck.reason} (LinkedIn scraping may not work)`);
    } else {
      console.log(`[MCP] Storage valid with ${storageCheck.cookieCount} LinkedIn cookies`);
    }

    // Retry connection to handle sidecar startup race condition
    const sseUrl = PLAYWRIGHT_MCP_URL.endsWith('/sse') ? PLAYWRIGHT_MCP_URL : `${PLAYWRIGHT_MCP_URL}/sse`;
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        mcpTransport = new SSEClientTransport(new URL(sseUrl));
        mcpClient = new Client({
          name: 'aviators-code-agent',
          version: '1.0.0'
        });
        await mcpClient.connect(mcpTransport);
        console.log('[MCP] Connected to Playwright MCP server (SSE)');
        return mcpClient;
      } catch (err) {
        mcpClient = null;
        mcpTransport = null;
        if (attempt < maxRetries) {
          const delay = attempt * 2;
          console.log(`[MCP] Sidecar not ready (attempt ${attempt}/${maxRetries}), retrying in ${delay}s...`);
          await new Promise(r => setTimeout(r, delay * 1000));
        } else {
          throw err;
        }
      }
    }
  }

  // Local dev: connect via stdio
  const storagePath = options.storagePath || STORAGE_PATH;
  const headless = options.headless !== false;
  
  // Check if storage is valid
  const storageCheck = isStorageValid(storagePath);
  if (!storageCheck.valid) {
    console.log(`[MCP] Storage check failed: ${storageCheck.reason}`);
    if (options.autoLogin !== false) {
      console.log('[MCP] Please run /login to authenticate with LinkedIn first.');
      throw new Error(`Invalid storage: ${storageCheck.reason}. Run /login to authenticate.`);
    }
  } else {
    console.log(`[MCP] Storage valid with ${storageCheck.cookieCount} LinkedIn cookies.`);
  }

  console.log('[MCP] Starting Playwright MCP server...');

  // Build command arguments
  const args = ['--storage-state', storagePath, '--isolated'];
  if (headless) {
    args.push('--headless');
  }

  // Create transport with stdio
  mcpTransport = new StdioClientTransport({
    command: 'node',
    args: [PLAYWRIGHT_MCP_PATH, ...args],
    env: { ...process.env }
  });

  // Create MCP client
  mcpClient = new Client({
    name: 'aviators-code-agent',
    version: '1.0.0'
  });

  // Connect to the server
  await mcpClient.connect(mcpTransport);
  console.log('[MCP] Connected to Playwright MCP server');

  return mcpClient;
}

/**
 * Disconnect from the MCP server
 */
export async function disconnectMCP() {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
    mcpTransport = null;
    console.log('[MCP] Disconnected from Playwright MCP server');
  }
}

/**
 * List available tools from the MCP server
 */
export async function listMCPTools() {
  const client = await connectToPlaywrightMCP();
  const result = await client.listTools();
  return result.tools;
}

/**
 * Call a tool on the MCP server
 * @param {string} toolName - Name of the tool to call
 * @param {object} args - Arguments for the tool
 */
export async function callMCPTool(toolName, args = {}) {
  const client = await connectToPlaywrightMCP();
  const result = await client.callTool({
    name: toolName,
    arguments: args
  });
  return result;
}

/**
 * Navigate to a URL and get the page content
 * @param {string} url - URL to navigate to
 */
export async function navigateAndGetContent(url) {
  await callMCPTool('browser_navigate', { url });
  // Wait for page to load more fully
  await new Promise(resolve => setTimeout(resolve, 2000));
  const snapshot = await callMCPTool('browser_snapshot');
  return snapshot;
}

/**
 * Click on an element
 * @param {string} element - Element description or ref
 */
export async function clickElement(element) {
  return await callMCPTool('browser_click', { element });
}

/**
 * Type text into an element
 * @param {string} element - Element description or ref
 * @param {string} text - Text to type
 */
export async function typeText(element, text) {
  return await callMCPTool('browser_type', { element, text });
}

/**
 * Take a screenshot
 */
export async function takeScreenshot() {
  return await callMCPTool('browser_take_screenshot');
}

/**
 * Scrape LinkedIn activity and extract author/external link
 * @param {string} url - LinkedIn activity URL
 */
export async function scrapeLinkedInActivity(url) {
  try {
    // Navigate to the LinkedIn activity
    await callMCPTool('browser_navigate', { url });
    
    // Wait a bit for content to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get page snapshot
    const snapshot = await callMCPTool('browser_snapshot');
    
    return {
      success: true,
      url,
      content: snapshot
    };
  } catch (error) {
    return {
      success: false,
      url,
      error: error.message
    };
  }
}

// MCP tool definitions for the agent
export const mcpPlaywrightTool = {
  name: 'playwright_navigate',
  description: 'Navigate to a URL using Playwright and get the page content. Use this to scrape web pages like the Tech Community blog. Returns the page HTML/text content that you can parse to extract information like blog post titles, dates, and links.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to (e.g., "https://techcommunity.microsoft.com/category/azure/blog/integrationsonazureblog")'
      }
    },
    required: ['url']
  },
  execute: async ({ url }) => {
    try {
      console.log(`[Playwright] Navigating to: ${url}`);
      const result = await navigateAndGetContent(url);
      console.log(`[Playwright] Got content, length: ${JSON.stringify(result).length} chars`);
      return { success: true, url, ...result };
    } catch (error) {
      console.error(`[Playwright] Error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
};

export const mcpSnapshotTool = {
  name: 'playwright_snapshot',
  description: 'Get the current page content/snapshot from Playwright MCP',
  parameters: {
    type: 'object',
    properties: {}
  },
  execute: async () => {
    try {
      const result = await callMCPTool('browser_snapshot');
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const mcpClickTool = {
  name: 'playwright_click',
  description: 'Click on an element in the current page',
  parameters: {
    type: 'object',
    properties: {
      element: {
        type: 'string',
        description: 'Description or ref of the element to click'
      }
    },
    required: ['element']
  },
  execute: async ({ element }) => {
    try {
      const result = await clickElement(element);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const mcpTypeTool = {
  name: 'playwright_type',
  description: 'Type text into an element in the current page',
  parameters: {
    type: 'object',
    properties: {
      element: {
        type: 'string',
        description: 'Description or ref of the element to type into'
      },
      text: {
        type: 'string',
        description: 'Text to type'
      }
    },
    required: ['element', 'text']
  },
  execute: async ({ element, text }) => {
    try {
      const result = await typeText(element, text);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

/**
 * Parse blog posts from Tech Community page content
 * Extracts posts with their titles, URLs, and dates
 */
function parseBlogPosts(content) {
  // Handle Playwright MCP response format
  let textContent = '';
  if (content && content.content && Array.isArray(content.content)) {
    textContent = content.content.map(c => c.text || '').join('\n');
  } else if (typeof content === 'string') {
    textContent = content;
  } else {
    textContent = JSON.stringify(content);
  }
  
  const lines = textContent.split('\n');
  const urlToPosts = new Map();
  
  // Single pass: track current post context and collect data
  let currentUrl = null;
  let currentTitle = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Look for link title
    const linkMatch = line.match(/link\s+"([^"]+)"\s+\[ref=/);
    if (linkMatch) {
      currentTitle = linkMatch[1];
    }
    
    // Look for blog URL
    const urlMatch = line.match(/\/url:\s*(\/blog\/integrationsonazureblog\/[^\s]+)/);
    if (urlMatch && urlMatch[1].length >= 40) {
      const fullUrl = `https://techcommunity.microsoft.com${urlMatch[1]}`;
      currentUrl = fullUrl;
      
      // Create or update post entry
      if (!urlToPosts.has(fullUrl) && currentTitle) {
        urlToPosts.set(fullUrl, { 
          title: currentTitle, 
          url: fullUrl, 
          dateStr: null, 
          date: null 
        });
      }
    }
    
    // Look for date - associate with most recent URL
    const dateMatch = line.match(/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})/i);
    if (dateMatch && currentUrl) {
      const post = urlToPosts.get(currentUrl);
      if (post && !post.date) {
        post.dateStr = dateMatch[0];
        post.date = new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`);
      }
    }
  }
  
  return Array.from(urlToPosts.values());
}

/**
 * Filter posts by date window
 */
function filterByDateWindow(posts, startDate, endDate) {
  return posts.filter(post => {
    if (!post.date) return false;
    
    const postTime = post.date.getTime();
    const startTime = new Date(startDate).getTime();
    const endTime = new Date(endDate).getTime();
    
    const inRange = postTime >= startTime && postTime <= endTime;
    
    // Also exclude newsletter posts
    const isNewsletter = post.title.toLowerCase().includes('aviators newsletter');
    
    return inRange && !isNewsletter;
  });
}

/**
 * Tool that fetches blog posts and filters by date range
 * This does server-side date filtering so the LLM doesn't have to parse dates
 */
export const techCommunityBlogTool = {
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
        description: 'The newsletter month (e.g., "February 2026")'
      },
      startDate: {
        type: 'string',
        description: 'Start date of the window in ISO format (e.g., "2026-01-06")'
      },
      endDate: {
        type: 'string',
        description: 'End date of the window in ISO format (e.g., "2026-02-01")'
      }
    },
    required: ['month', 'startDate', 'endDate']
  },
  execute: async ({ month, startDate, endDate }) => {
    try {
      console.log(`[TechCommunityBlog] Fetching posts for ${month} (${startDate} to ${endDate})`);
      
      const url = 'https://techcommunity.microsoft.com/category/azure/blog/integrationsonazureblog';
      console.log(`[TechCommunityBlog] Navigating to: ${url}`);
      
      await callMCPTool('browser_navigate', { url });
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for page to load
      const snapshot = await callMCPTool('browser_snapshot');
      
      // Parse posts from the page content
      const allPosts = parseBlogPosts(snapshot);
      console.log(`[TechCommunityBlog] Found ${allPosts.length} total posts on page`);
      
      // Filter by date window
      const filteredPosts = filterByDateWindow(allPosts, startDate, endDate);
      console.log(`[TechCommunityBlog] ${filteredPosts.length} posts within date range`);
      
      // Log what we found and filtered
      if (allPosts.length > 0) {
        console.log(`[TechCommunityBlog] Posts found:`);
        allPosts.slice(0, 10).forEach(p => {
          console.log(`  - "${p.title}" (${p.dateStr || 'no date'}) ${p.date ? (p.date >= new Date(startDate) && p.date <= new Date(endDate) ? '✓' : '✗') : '?'}`);
        });
      }
      
      return {
        success: true,
        month,
        dateWindow: { start: startDate, end: endDate },
        totalFound: allPosts.length,
        matchingPosts: filteredPosts.length,
        posts: filteredPosts.map(p => ({
          title: p.title,
          url: p.url,
          date: p.dateStr
        })),
        message: filteredPosts.length > 0 
          ? `Found ${filteredPosts.length} posts within ${month} date window. Use playwright_navigate to fetch details for each post URL.`
          : `No posts found within the ${month} date window (${startDate} to ${endDate}). The newsletter may have no Product Group news for this period.`
      };
    } catch (error) {
      console.error(`[TechCommunityBlog] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to fetch blog posts. Try using playwright_navigate directly.'
      };
    }
  }
};
