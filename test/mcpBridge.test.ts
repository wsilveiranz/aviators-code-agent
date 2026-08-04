import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLAYWRIGHT_CONTAINER_STORAGE_DIRECTORY,
  buildPlaywrightMcpArguments,
  isStorageValid,
  validateEmailMcpEndpoint,
} from '../src/core/mcpBridge.js';

type TestFunction = () => void;

function test(name: string, fn: TestFunction): boolean {
  try {
    fn();
    console.log(`✓ ${name}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`✗ ${name}`);
    console.log(`  Error: ${message}`);
    return false;
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected "${String(expected)}", got "${String(actual)}"`,
    );
  }
}

function assertTrue(actual: unknown, message: string): asserts actual {
  if (!actual) {
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertThrows(
  fn: () => unknown,
  expectedMessage: string,
  message: string,
): void {
  try {
    fn();
  } catch (error) {
    const actual = error instanceof Error ? error.message : String(error);
    if (actual.includes(expectedMessage)) {
      return;
    }
    throw new Error(
      `${message}: expected error containing "${expectedMessage}", got "${actual}"`,
    );
  }

  throw new Error(`${message}: expected function to throw`);
}

const fixtureDirectory = join(__dirname, 'mcpBridge-fixtures');
const storagePath = join(fixtureDirectory, 'storage.json');

function writeStorage(cookies: unknown[]): void {
  mkdirSync(fixtureDirectory, { recursive: true });
  writeFileSync(storagePath, JSON.stringify({ cookies }), 'utf8');
}

console.log('\n=== MCP Bridge Security Tests ===\n');

let passed = 0;
let failed = 0;

if (
  test('Should mount Docker storage and omit missing storage state', () => {
    const args = buildPlaywrightMcpArguments({
      command: 'C:\\Program Files\\Docker\\docker.exe',
      args: [
        'run',
        '-i',
        '--rm',
        '--init',
        'mcr.microsoft.com/playwright/mcp',
      ],
      storageDirectory: 'C:\\extension storage',
      storagePath: 'C:\\extension storage\\storage.json',
      storageExists: false,
      headless: true,
    });

    assertEqual(args[1], '--mount', 'Docker mount flag position');
    assertEqual(
      args[2],
      `type=bind,source=C:\\extension storage,target=${PLAYWRIGHT_CONTAINER_STORAGE_DIRECTORY}`,
      'Docker mount specification',
    );
    assertEqual(
      args.includes('--storage-state'),
      false,
      'Missing storage state flag',
    );
    assertEqual(args.at(-2), '--isolated', 'Isolated flag');
    assertEqual(args.at(-1), '--headless', 'Headless flag');
  })
) {
  passed += 1;
} else {
  failed += 1;
}

if (
  test('Should use the container storage path when Docker state exists', () => {
    const args = buildPlaywrightMcpArguments({
      command: 'docker',
      args: ['run', '--rm', 'mcr.microsoft.com/playwright/mcp'],
      storageDirectory: '/host/storage',
      storagePath: '/host/storage/storage.json',
      storageExists: true,
      headless: false,
    });
    const storageIndex = args.indexOf('--storage-state');

    assertTrue(storageIndex >= 0, 'Storage state flag');
    assertEqual(
      args[storageIndex + 1],
      `${PLAYWRIGHT_CONTAINER_STORAGE_DIRECTORY}/storage.json`,
      'Container-visible storage path',
    );
  })
) {
  passed += 1;
} else {
  failed += 1;
}

if (
  test('Should preserve portable non-Docker commands and host storage paths', () => {
    const hostStoragePath = 'C:\\extension storage\\storage.json';
    const args = buildPlaywrightMcpArguments({
      command: 'npx',
      args: [
        '--yes',
        '@playwright/mcp@latest',
        '--storage-state=stale.json',
      ],
      storageDirectory: 'C:\\extension storage',
      storagePath: hostStoragePath,
      storageExists: true,
      headless: false,
    });
    const storageIndex = args.indexOf('--storage-state');

    assertEqual(args.includes('--mount'), false, 'Non-Docker mount flag');
    assertEqual(
      args.includes('--storage-state=stale.json'),
      false,
      'Configured storage state override',
    );
    assertEqual(
      args[storageIndex + 1],
      hostStoragePath,
      'Host-visible storage path',
    );
    assertEqual(args.at(-1), '--isolated', 'Non-Docker isolated flag');
  })
) {
  passed += 1;
} else {
  failed += 1;
}

if (
  test('Should reject a Docker command without run', () => {
    assertThrows(
      () =>
        buildPlaywrightMcpArguments({
          command: 'docker',
          args: ['version'],
          storageDirectory: '/host/storage',
          storagePath: '/host/storage/storage.json',
          storageExists: false,
          headless: true,
        }),
      'must include the "run" subcommand',
      'Docker command validation',
    );
  })
) {
  passed += 1;
} else {
  failed += 1;
}

for (const endpoint of [
  'https://email.example.com/mcp',
  'http://localhost:3000/mcp',
  'http://127.0.0.1:3000/mcp',
  'http://[::1]:3000/mcp',
]) {
  if (
    test(`Should allow secure or loopback endpoint ${endpoint}`, () => {
      assertEqual(
        validateEmailMcpEndpoint(endpoint).protocol,
        endpoint.startsWith('https:') ? 'https:' : 'http:',
        'Validated endpoint protocol',
      );
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }
}

for (const endpoint of [
  'http://email.example.com/mcp',
  'http://localhost.example.com/mcp',
  'http://127.0.0.2/mcp',
]) {
  if (
    test(`Should reject plaintext non-loopback endpoint ${endpoint}`, () => {
      assertThrows(
        () => validateEmailMcpEndpoint(endpoint),
        'must use HTTPS because its API key is sent',
        'Plaintext endpoint validation',
      );
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }
}

if (
  test('Should require a LinkedIn li_at cookie on an exact domain', () => {
    writeStorage([
      {
        name: 'li_at',
        value: 'auth-token',
        domain: '.www.linkedin.com.evil.example',
        expires: Date.now() / 1000 + 3600,
      },
    ]);

    const validation = isStorageValid(storagePath);
    assertEqual(validation.valid, false, 'Spoofed LinkedIn domain validity');
    assertEqual(
      validation.reason,
      'No LinkedIn cookies found',
      'Spoofed LinkedIn domain reason',
    );
  })
) {
  passed += 1;
} else {
  failed += 1;
}

if (
  test('Should reject LinkedIn storage without a li_at auth cookie', () => {
    writeStorage([
      {
        name: 'JSESSIONID',
        value: 'session',
        domain: '.linkedin.com',
        expires: Date.now() / 1000 + 3600,
      },
    ]);

    const validation = isStorageValid(storagePath);
    assertEqual(validation.valid, false, 'Missing auth cookie validity');
    assertEqual(
      validation.reason,
      'No LinkedIn li_at authentication cookie found',
      'Missing auth cookie reason',
    );
  })
) {
  passed += 1;
} else {
  failed += 1;
}

if (
  test('Should accept a non-expired LinkedIn li_at auth cookie', () => {
    writeStorage([
      {
        name: 'li_at',
        value: 'auth-token',
        domain: '.www.linkedin.com',
        expires: Date.now() / 1000 + 3600,
      },
      {
        name: 'JSESSIONID',
        value: 'session',
        domain: '.linkedin.com',
        expires: -1,
      },
    ]);

    const validation = isStorageValid(storagePath);
    assertEqual(validation.valid, true, 'Valid auth cookie');
    assertEqual(validation.cookieCount, 2, 'LinkedIn cookie count');
  })
) {
  passed += 1;
} else {
  failed += 1;
}

if (
  test('Should accept the explicit Playwright session-cookie expiry', () => {
    writeStorage([
      {
        name: 'li_at',
        value: 'auth-token',
        domain: 'linkedin.com',
        expires: -1,
      },
    ]);

    assertEqual(
      isStorageValid(storagePath).valid,
      true,
      'Session auth cookie validity',
    );
  })
) {
  passed += 1;
} else {
  failed += 1;
}

for (const expires of [0, -2, Date.now() / 1000 - 60]) {
  if (
    test(`Should reject invalid or expired li_at expiry ${expires}`, () => {
      writeStorage([
        {
          name: 'li_at',
          value: 'auth-token',
          domain: '.linkedin.com',
          expires,
        },
      ]);

      assertEqual(
        isStorageValid(storagePath).valid,
        false,
        'Invalid auth cookie expiry',
      );
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }
}

rmSync(fixtureDirectory, { recursive: true, force: true });

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exitCode = 1;
}
