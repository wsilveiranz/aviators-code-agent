import { readFileSync, existsSync } from 'node:fs';

import type { JsonObject } from './types.js';

export type McpServer = 'email' | 'playwright';

export interface McpBridge {
  callTool(
    server: McpServer,
    toolName: string,
    args?: JsonObject,
  ): Promise<unknown>;
}

export type McpBridgeFactory = () => McpBridge | Promise<McpBridge>;

export interface StorageValidationResult {
  valid: boolean;
  reason?: string;
  cookieCount?: number;
}

interface BrowserCookie {
  name?: string;
  value?: string;
  domain?: string;
  expires?: number;
}

interface BrowserStorageState {
  cookies?: BrowserCookie[];
}

export const DEFAULT_STORAGE_PATH =
  process.env.PLAYWRIGHT_STORAGE_PATH ||
  'C:\\dev\\aviator-newsletter-agent\\.github\\tools\\playwright-login\\storage.json';

export const PLAYWRIGHT_CONTAINER_STORAGE_DIRECTORY = '/aviators-storage';

const LINKEDIN_COOKIE_DOMAINS = new Set(['linkedin.com', 'www.linkedin.com']);
const LINKEDIN_AUTH_COOKIE_NAME = 'li_at';
const SESSION_COOKIE_EXPIRY = -1;

export interface PlaywrightMcpLaunchOptions {
  command: string;
  args: string[];
  storageDirectory: string;
  storagePath: string;
  storageExists: boolean;
  headless: boolean;
}

export function buildPlaywrightMcpArguments({
  command,
  args,
  storageDirectory,
  storagePath,
  storageExists,
  headless,
}: PlaywrightMcpLaunchOptions): string[] {
  const result = removeStorageStateArguments(args);
  let runtimeStoragePath = storagePath;

  if (isDockerCommand(command)) {
    const runIndex = result.findIndex(
      (argument) => argument.toLowerCase() === 'run',
    );
    if (runIndex === -1) {
      throw new Error(
        'The Docker Playwright MCP command must include the "run" subcommand.',
      );
    }

    result.splice(
      runIndex + 1,
      0,
      '--mount',
      `type=bind,source=${storageDirectory},target=${PLAYWRIGHT_CONTAINER_STORAGE_DIRECTORY}`,
    );
    runtimeStoragePath = `${PLAYWRIGHT_CONTAINER_STORAGE_DIRECTORY}/storage.json`;
  }

  if (storageExists) {
    result.push('--storage-state', runtimeStoragePath);
  }
  result.push('--isolated');
  if (headless) {
    result.push('--headless');
  }

  return result;
}

export function validateEmailMcpEndpoint(endpoint: string): URL {
  if (!endpoint) {
    throw new Error(
      'No EmailCompanion MCP endpoint is configured. Set aviators.email.mcpEndpoint.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(
      'The EmailCompanion MCP endpoint is invalid. Configure a valid HTTPS URL, or an HTTP URL on a loopback host for development.',
    );
  }

  if (parsed.protocol === 'https:') {
    return parsed;
  }

  if (parsed.protocol !== 'http:') {
    throw new Error(
      'The EmailCompanion MCP endpoint must use HTTPS. HTTP is allowed only on localhost, 127.0.0.1, or ::1 for development.',
    );
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(
      'The EmailCompanion MCP endpoint must use HTTPS because its API key is sent in a request header. Plaintext HTTP is allowed only on localhost, 127.0.0.1, or ::1 for development.',
    );
  }

  return parsed;
}

export function isStorageValid(
  storagePath = DEFAULT_STORAGE_PATH,
): StorageValidationResult {
  try {
    if (!existsSync(storagePath)) {
      return { valid: false, reason: 'Storage file does not exist' };
    }

    const content = readFileSync(storagePath, 'utf-8');
    const state = JSON.parse(content) as BrowserStorageState;

    if (!state.cookies || state.cookies.length === 0) {
      return { valid: false, reason: 'Storage file has no cookies' };
    }

    const linkedInCookies = state.cookies.filter((cookie) =>
      isLinkedInCookieDomain(cookie.domain),
    );
    if (linkedInCookies.length === 0) {
      return { valid: false, reason: 'No LinkedIn cookies found' };
    }

    const authCookies = linkedInCookies.filter(
      (cookie) =>
        cookie.name === LINKEDIN_AUTH_COOKIE_NAME &&
        typeof cookie.value === 'string' &&
        cookie.value.length > 0,
    );
    if (authCookies.length === 0) {
      return {
        valid: false,
        reason: 'No LinkedIn li_at authentication cookie found',
      };
    }

    const now = Date.now() / 1000;
    const validAuthCookies = authCookies.filter(
      (cookie) =>
        cookie.expires === SESSION_COOKIE_EXPIRY ||
        (typeof cookie.expires === 'number' &&
          Number.isFinite(cookie.expires) &&
          cookie.expires > now),
    );
    if (validAuthCookies.length === 0) {
      return {
        valid: false,
        reason:
          'The LinkedIn li_at authentication cookie has expired or has an invalid expiry',
      };
    }

    return { valid: true, cookieCount: linkedInCookies.length };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { valid: false, reason: `Error reading storage: ${reason}` };
  }
}

function isDockerCommand(command: string): boolean {
  const executable = command.trim().split(/[\\/]/).pop()?.toLowerCase();
  return executable === 'docker' || executable === 'docker.exe';
}

function removeStorageStateArguments(args: string[]): string[] {
  const result: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--storage-state') {
      index += 1;
      continue;
    }
    if (argument.startsWith('--storage-state=')) {
      continue;
    }
    result.push(argument);
  }

  return result;
}

function isLinkedInCookieDomain(domain: string | undefined): boolean {
  if (!domain) {
    return false;
  }

  return LINKEDIN_COOKIE_DOMAINS.has(domain.toLowerCase().replace(/^\./, ''));
}
