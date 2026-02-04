/**
 * Playwright Tools
 * Tools for scraping LinkedIn activities and processing URLs
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run a command and return the result
 * @param {string} command 
 * @param {string[]} args 
 * @param {object} options 
 * @returns {Promise<{success: boolean, stdout: string, stderr: string}>}
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { 
      shell: true,
      cwd: options.cwd || process.cwd(),
      ...options
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        exitCode: code
      });
    });
    
    proc.on('error', (err) => {
      resolve({
        success: false,
        stdout,
        stderr: err.message,
        exitCode: -1
      });
    });
  });
}

export const scrapeLinkedInTool = {
  name: 'scrapeLinkedIn',
  description: 'Scrape LinkedIn activity URLs to extract author profile and external links. Uses Playwright for browser automation.',
  parameters: {
    type: 'object',
    properties: {
      inputJson: {
        type: 'string',
        description: 'Either a path to a JSON file containing URLs array, OR a JSON string array like ["url1","url2"]'
      },
      outputJson: {
        type: 'string',
        description: 'Path for output JSON file with scraped data'
      },
      storagePath: {
        type: 'string',
        description: 'Path to Playwright storage.json with login state'
      },
      headful: {
        type: 'boolean',
        description: 'Run browser in headful mode (visible)',
        default: false
      },
      delayMs: {
        type: 'number',
        description: 'Delay between requests in milliseconds',
        default: 4000
      }
    },
    required: ['inputJson', 'outputJson', 'storagePath']
  },
  execute: async ({ inputJson, outputJson, storagePath, headful = false, delayMs = 4000 }) => {
    // Find the scraper script - check relative paths
    const possiblePaths = [
      path.join(__dirname, '../../.github/tools/playwright-scrape/run-sequential.js'),
      path.join(process.cwd(), '.github/tools/playwright-scrape/run-sequential.js'),
      'C:\\dev\\aviator-newsletter-agent\\.github\\tools\\playwright-scrape\\run-sequential.js'
    ];
    
    let scraperPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        scraperPath = p;
        break;
      }
    }
    
    if (!scraperPath) {
      return {
        success: false,
        error: 'Playwright scraper not found. Ensure run-sequential.js exists in .github/tools/playwright-scrape/'
      };
    }
    
    // Handle inline JSON array - save to temp file
    let actualInputPath = inputJson;
    if (inputJson.trim().startsWith('[')) {
      try {
        const urls = JSON.parse(inputJson);
        const tempPath = path.join(process.cwd(), 'outputs', `temp-urls-${Date.now()}.json`);
        fs.mkdirSync(path.dirname(tempPath), { recursive: true });
        fs.writeFileSync(tempPath, JSON.stringify(urls, null, 2));
        actualInputPath = tempPath;
        console.log(`[scrapeLinkedIn] Saved ${urls.length} URLs to temp file: ${tempPath}`);
      } catch (e) {
        return { success: false, error: `Failed to parse inline JSON: ${e.message}` };
      }
    }
    
    // Check if input file exists
    if (!fs.existsSync(actualInputPath)) {
      return { success: false, error: `Input file not found: ${actualInputPath}` };
    }
    
    // Get the scraper directory to use as CWD
    const scraperDir = path.dirname(scraperPath);
    
    // Resolve paths relative to CWD before changing to scraper dir
    const absoluteInputPath = path.resolve(actualInputPath);
    const absoluteOutputPath = path.resolve(outputJson);
    const absoluteStoragePath = path.resolve(storagePath.startsWith('C:') ? storagePath : 
      path.join('C:\\dev\\aviator-newsletter-agent\\.github\\tools\\playwright-login', storagePath));
    
    const args = [
      scraperPath,
      '--storage', absoluteStoragePath,
      '--input', absoluteInputPath,
      '--out-json', absoluteOutputPath
    ];
    
    if (headful) args.push('--headful');
    if (delayMs) args.push('--delay-ms', String(delayMs));
    
    console.log(`[scrapeLinkedIn] Running from ${scraperDir}: node ${args.join(' ')}`);
    
    // Run from the scraper directory so it can find scrape-linkedin.js
    const result = await runCommand('node', args, { cwd: scraperDir });
    
    if (result.success && fs.existsSync(absoluteOutputPath)) {
      const data = JSON.parse(fs.readFileSync(absoluteOutputPath, 'utf-8'));
      return {
        success: true,
        outputPath: absoluteOutputPath,
        itemCount: data.length,
        items: data
      };
    }
    
    return {
      success: false,
      error: result.stderr || 'Scraping failed',
      stdout: result.stdout
    };
  }
};

export const resolveRedirectsTool = {
  name: 'resolveRedirects',
  description: 'Post-process scraped links to resolve redirects and extract final URLs.',
  parameters: {
    type: 'object',
    properties: {
      inputJson: {
        type: 'string',
        description: 'Either a path to a JSON file with scraped data, OR a JSON string'
      },
      outputJson: {
        type: 'string',
        description: 'Path for output JSON file with resolved URLs'
      },
      storagePath: {
        type: 'string',
        description: 'Path to Playwright storage.json with login state'
      },
      headful: {
        type: 'boolean',
        description: 'Run browser in headful mode (visible)',
        default: false
      },
      delayMs: {
        type: 'number',
        description: 'Delay between requests in milliseconds',
        default: 1500
      }
    },
    required: ['inputJson', 'outputJson', 'storagePath']
  },
  execute: async ({ inputJson, outputJson, storagePath, headful = false, delayMs = 1500 }) => {
    // Find the post-processor script
    const possiblePaths = [
      path.join(__dirname, '../../.github/tools/playwright-scrape/post-process-playwright.js'),
      path.join(process.cwd(), '.github/tools/playwright-scrape/post-process-playwright.js'),
      'C:\\dev\\aviator-newsletter-agent\\.github\\tools\\playwright-scrape\\post-process-playwright.js'
    ];
    
    let processorPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        processorPath = p;
        break;
      }
    }
    
    if (!processorPath) {
      return {
        success: false,
        error: 'Post-processor not found. Ensure post-process-playwright.js exists in .github/tools/playwright-scrape/'
      };
    }
    
    // Handle inline JSON - save to temp file
    let actualInputPath = inputJson;
    if (inputJson.trim().startsWith('[') || inputJson.trim().startsWith('{')) {
      try {
        const data = JSON.parse(inputJson);
        const tempPath = path.join(process.cwd(), 'outputs', `temp-resolve-${Date.now()}.json`);
        fs.mkdirSync(path.dirname(tempPath), { recursive: true });
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
        actualInputPath = tempPath;
        console.log(`[resolveRedirects] Saved inline JSON to temp file: ${tempPath}`);
      } catch (e) {
        return { success: false, error: `Failed to parse inline JSON: ${e.message}` };
      }
    }
    
    // Check if input file exists
    if (!fs.existsSync(actualInputPath)) {
      return { success: false, error: `Input file not found: ${actualInputPath}` };
    }
    
    // Get the processor directory to use as CWD
    const processorDir = path.dirname(processorPath);
    
    // Resolve paths to absolute
    const absoluteInputPath = path.resolve(actualInputPath);
    const absoluteOutputPath = path.resolve(outputJson);
    const absoluteStoragePath = path.resolve(storagePath.startsWith('C:') ? storagePath : 
      path.join('C:\\dev\\aviator-newsletter-agent\\.github\\tools\\playwright-login', storagePath));
    
    const args = [
      processorPath,
      '--in-json', absoluteInputPath,
      '--out-json', absoluteOutputPath,
      '--storage', absoluteStoragePath
    ];
    
    if (headful) args.push('--headful');
    if (delayMs) args.push('--delay-ms', String(delayMs));
    
    console.log(`[resolveRedirects] Running from ${processorDir}: node ${args.join(' ')}`);
    
    // Run from the processor directory
    const result = await runCommand('node', args, { cwd: processorDir });
    
    if (result.success && fs.existsSync(absoluteOutputPath)) {
      const data = JSON.parse(fs.readFileSync(absoluteOutputPath, 'utf-8'));
      return {
        success: true,
        outputPath: absoluteOutputPath,
        itemCount: data.length,
        items: data
      };
    }
    
    return {
      success: false,
      error: result.stderr || 'Post-processing failed',
      stdout: result.stdout
    };
  }
};
