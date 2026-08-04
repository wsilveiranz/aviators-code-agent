import { spawn } from 'node:child_process';
import { join } from 'node:path';

const tests = [
  'aceAviator.test.js',
  'communityNews.test.js',
  'productGroup.test.js',
  'newsletter.test.js',
  'mcpBridge.test.js',
  'mcpClientProtocol.test.js',
];

function runTest(testFile: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, testFile)], {
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function runAll(): Promise<void> {
  console.log('\n========================================');
  console.log('  Newsletter Agent Test Suite');
  console.log('========================================\n');

  let allPassed = true;
  for (const testFile of tests) {
    const code = await runTest(testFile);
    if (code !== 0) allPassed = false;
  }

  console.log('\n========================================');
  console.log(allPassed ? '  All tests passed! ✓' : '  Some tests failed ✗');
  console.log('========================================\n');

  process.exitCode = allPassed ? 0 : 1;
}

void runAll();
