import {
  detectSection,
  summarizeToolResult,
  type NewsletterSection,
} from '../src/core/newsletter.js';
import {
  extractRequestedNewsletterFileName,
  isNewsletterTemplateRequest,
} from '../src/core/newsletterRequest.js';
import { detectRequiredSkills } from '../src/core/skillPrompts.js';
import {
  TOOL_RESULT_TRUNCATION_MARKER,
  findExplicitToolFailure,
  truncateSerializedToolResult,
} from '../src/extension/toolResult.js';

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
    throw new Error(`${message}: expected "${String(expected)}", got "${String(actual)}"`);
  }
}

function assertTrue(actual: unknown, message: string): asserts actual {
  if (!actual) {
    throw new Error(`${message}: expected truthy value`);
  }
}

console.log('\n=== Newsletter Core Tests ===\n');

let passed = 0;
let failed = 0;

const sections: Array<[string, NewsletterSection]> = [
  ['<h1 id="aceaviator">Ace Aviator of the Month</h1>', 'aceAviator'],
  ['<h1>News from our product group</h1>', 'productGroup'],
  ['<h1 id="communitynews">Community</h1>', 'community'],
];

for (const [html, expected] of sections) {
  if (test(`Should detect ${expected}`, () => {
    assertEqual(detectSection(html), expected, 'Detected section');
  })) passed += 1; else failed += 1;
}

if (test('Should reject content without HTML', () => {
  assertEqual(detectSection('Ace Aviator of the Month'), null, 'Plain text section');
})) passed += 1; else failed += 1;

if (test('Should reject HTML containing multiple newsletter sections', () => {
  const html = '<h1 id="aceaviator">Ace</h1><h1 id="communitynews">Community</h1>';
  assertEqual(detectSection(html), null, 'Multi-section HTML');
})) passed += 1; else failed += 1;

if (test('Should safely summarize unknown primitive results', () => {
  assertEqual(summarizeToolResult(42), '42', 'Number summary');
  assertEqual(summarizeToolResult('not json'), 'not json', 'String summary');
  assertEqual(summarizeToolResult(null), 'null', 'Null summary');
  assertEqual(summarizeToolResult(undefined), undefined, 'Undefined summary');
})) passed += 1; else failed += 1;

if (test('Should safely summarize nested posts with unknown values', () => {
  const summary = summarizeToolResult({
    success: true,
    filteredCount: 2,
    posts: [
      null,
      {
        title: 'Nested post',
        link: 'https://example.com/post',
        publishedAt: '2026-01-20',
        metadata: { ignored: ['safe'] },
      },
    ],
  });
  assertTrue(summary, 'Should return a summary');
  const parsed = JSON.parse(summary) as {
    posts: Array<{ title?: string; link?: string }>;
  };
  assertEqual(parsed.posts.length, 2, 'Nested post count');
  assertEqual(parsed.posts[1].title, 'Nested post', 'Nested post title');
})) passed += 1; else failed += 1;

if (test('Should safely summarize nested MCP content', () => {
  const summary = summarizeToolResult({
    content: [
      null,
      { type: 'text', text: 'short result', nested: { value: true } },
    ],
  });
  assertTrue(summary, 'Should return a content summary');
  assertTrue(summary.includes('short result'), 'Should preserve text content');
})) passed += 1; else failed += 1;

if (test('Should reject failed tool results even when they contain section HTML', () => {
  const failure = findExplicitToolFailure([
    {
      value:
        'Create Community News result:\n{"success":false,"error":"Fabricated data detected","html":"<h1 id=\\"communitynews\\">Community</h1>"}',
    },
  ]);
  assertEqual(failure, 'Fabricated data detected', 'Failure detail');
})) passed += 1; else failed += 1;

if (test('Should explicitly mark truncated tool results and preserve both ends', () => {
  const truncated = truncateSerializedToolResult('abcdefghij', 4);
  assertTrue(
    truncated.includes(TOOL_RESULT_TRUNCATION_MARKER),
    'Truncation marker',
  );
  assertTrue(truncated.startsWith('abc'), 'Truncated head');
  assertTrue(truncated.endsWith('j'), 'Truncated tail');
})) passed += 1; else failed += 1;

if (test('Should recognize model-free newsletter template requests', () => {
  assertTrue(
    isNewsletterTemplateRequest(
      'Let us start the August 2026 newsletter and create the template.',
    ),
    'Template intent',
  );
  assertEqual(
    detectRequiredSkills('Create the August 2026 newsletter template.').length,
    0,
    'Template skill count',
  );
})) passed += 1; else failed += 1;

if (test('Should extract an explicit safe newsletter filename', () => {
  assertEqual(
    extractRequestedNewsletterFileName(
      'Create the August 2026 template and save it as aviators-july.html.',
    ),
    'aviators-july.html',
    'Explicit filename',
  );
})) passed += 1; else failed += 1;

if (test('Should only load all skills for explicit full generation', () => {
  assertEqual(
    detectRequiredSkills('Generate the full newsletter for August 2026').length,
    4,
    'Full newsletter skill count',
  );
})) passed += 1; else failed += 1;

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) process.exitCode = 1;
