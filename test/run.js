/**
 * Test runner - runs all tests
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const tests = [
  'aceAviator.test.js',
  'communityNews.test.js',
  'productGroup.test.js'
];

async function runTest(testFile) {
  return new Promise((resolve) => {
    const child = spawn('node', [join(__dirname, testFile)], {
      stdio: 'inherit',
      shell: true
    });
    child.on('close', (code) => resolve(code));
  });
}

async function runAll() {
  console.log('\n========================================');
  console.log('  Newsletter Agent Test Suite');
  console.log('========================================\n');
  
  let allPassed = true;
  for (const test of tests) {
    const code = await runTest(test);
    if (code !== 0) allPassed = false;
  }
  
  console.log('\n========================================');
  console.log(allPassed ? '  All tests passed! ✓' : '  Some tests failed ✗');
  console.log('========================================\n');
  
  process.exit(allPassed ? 0 : 1);
}

runAll();
