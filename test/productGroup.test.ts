import {
  extractFinalPageUrl,
  filterByDateWindow,
  parseBlogPosts,
} from '../src/core/playwrightTools.js';
import {
  filterPosts,
  generateHTML as generateProductGroupHTML,
  selectProductGroupPosts,
  type ProductGroupPost,
} from '../src/core/productGroup.js';
import { feb2026DateWindow, sampleBlogSnapshot } from './sampleData.js';

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
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertArrayLength<T>(array: T[], expected: number, message: string): void {
  if (array.length !== expected) {
    throw new Error(`${message}: expected ${expected} items, got ${array.length}`);
  }
}

console.log('\n=== Product Group Blog Parsing Tests ===\n');

let passed = 0;
let failed = 0;

const boundarySnapshot = {
  content: [{
    type: 'text',
    text: `### Snapshot
- article:
  - link "Start Boundary Post" [ref=e1]:
    - /url: /blog/integrationsonazureblog/start-boundary-post-with-a-long-path/4500001
  - text: Jan 06, 2026
- article:
  - link "End Boundary Post" [ref=e2]:
    - /url: /blog/integrationsonazureblog/end-boundary-post-with-a-long-path/4500002
  - text: Feb 01, 2026
- article:
  - link "Before Window Post" [ref=e3]:
    - /url: /blog/integrationsonazureblog/before-window-post-with-a-long-path/4500003
  - text: Jan 05, 2026
- article:
  - link "After Window Post" [ref=e4]:
    - /url: /blog/integrationsonazureblog/after-window-post-with-a-long-path/4500004
  - text: Feb 02, 2026`,
  }],
};

if (test('Should parse blog posts from Playwright snapshot', () => {
  assertArrayLength(parseBlogPosts(sampleBlogSnapshot), 7, 'Total posts found');
})) passed += 1; else failed += 1;

if (test('Should extract correct titles', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  assertEqual(posts[0].title, 'Logic Apps Aviators Newsletter - February 2026', 'First post title');
  assertEqual(posts[1].title, 'Introducing Unit Test Agent Profiles for Logic Apps & Data Maps', 'Second post title');
})) passed += 1; else failed += 1;

if (test('Should build full URLs from relative paths', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  assertEqual(posts[1].url.startsWith('https://techcommunity.microsoft.com/blog/'), true, 'Full URL');
})) passed += 1; else failed += 1;

if (test('Should parse dates correctly', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  assertEqual(posts[0].dateStr, 'Feb 02, 2026', 'First post date');
  assertEqual(posts[1].dateStr, 'Jan 28, 2026', 'Second post date');
  assertEqual(posts[5].dateStr, 'Dec 17, 2025', 'December post date');
})) passed += 1; else failed += 1;

if (test('Should filter posts within February 2026 date window', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  const filtered = filterByDateWindow(
    posts,
    feb2026DateWindow.startDate,
    feb2026DateWindow.endDate,
  );
  assertArrayLength(filtered, 3, 'Posts within date window');
})) passed += 1; else failed += 1;

if (test('Should exclude Aviators Newsletter posts', () => {
  const filtered = filterByDateWindow(
    parseBlogPosts(sampleBlogSnapshot),
    '2025-01-01',
    '2026-12-31',
  );
  assertArrayLength(
    filtered.filter((post) => post.title.toLowerCase().includes('aviators newsletter')),
    0,
    'Newsletter posts',
  );
})) passed += 1; else failed += 1;

if (test('Should include only posts inside the window', () => {
  const filtered = filterByDateWindow(
    parseBlogPosts(sampleBlogSnapshot),
    feb2026DateWindow.startDate,
    feb2026DateWindow.endDate,
  );
  const titles = filtered.map((post) => post.title);
  assertEqual(
    titles.includes('Introducing Unit Test Agent Profiles for Logic Apps & Data Maps'),
    true,
    'Should include Jan 28 post',
  );
  assertEqual(
    titles.includes('Upcoming Agentic Azure Logic Apps Workshops'),
    true,
    'Should include Jan 09 post',
  );
})) passed += 1; else failed += 1;

if (test('Should include Pacific date-only boundary days', () => {
  const filtered = filterByDateWindow(
    parseBlogPosts(boundarySnapshot),
    feb2026DateWindow.startDate,
    feb2026DateWindow.endDate,
  );
  assertArrayLength(filtered, 2, 'Boundary posts');
  assertEqual(filtered[0].title, 'Start Boundary Post', 'Start boundary title');
  assertEqual(filtered[1].title, 'End Boundary Post', 'End boundary title');
})) passed += 1; else failed += 1;

if (test('Should filter Product Group date-only values by Pacific calendar date', () => {
  const posts: ProductGroupPost[] = [
    {
      title: 'Start Boundary',
      link: 'https://example.com/start',
      publishedAt: '2026-01-06',
      summary: 'Start',
    },
    {
      title: 'End Boundary',
      link: 'https://example.com/end',
      publishedAt: '2026-02-01',
      summary: 'End',
    },
    {
      title: 'Before Boundary',
      link: 'https://example.com/before',
      publishedAt: '2026-01-05',
      summary: 'Before',
    },
    {
      title: 'After Boundary',
      link: 'https://example.com/after',
      publishedAt: '2026-02-02',
      summary: 'After',
    },
  ];
  const filtered = filterPosts(
    posts,
    new Date('2026-01-06T00:00:00-08:00'),
    new Date('2026-02-01T23:59:59-08:00'),
  );

  assertArrayLength(filtered, 2, 'Product Group boundary posts');
  assertEqual(filtered[0].title, 'Start Boundary', 'Product Group start boundary');
  assertEqual(filtered[1].title, 'End Boundary', 'Product Group end boundary');
})) passed += 1; else failed += 1;

if (test('Should include a supplied out-of-window post when explicitly overridden', () => {
  const posts: ProductGroupPost[] = [
    {
      title: 'Explicitly included post',
      link: 'https://example.com/override',
      publishedAt: '2026-07-06',
      summary: 'User explicitly requested this post.',
    },
  ];
  const selected = selectProductGroupPosts(
    posts,
    new Date('2026-07-07T00:00:00-07:00'),
    new Date('2026-08-02T23:59:59-07:00'),
    true,
  );
  assertArrayLength(selected, 1, 'Overridden Product Group posts');
  assertEqual(selected[0].title, 'Explicitly included post', 'Override title');
})) passed += 1; else failed += 1;

if (test('Should keep the date window strict without an explicit override', () => {
  const selected = selectProductGroupPosts(
    [{
      title: 'Out-of-window post',
      link: 'https://example.com/outside',
      publishedAt: '2026-07-06',
      summary: 'Outside',
    }],
    new Date('2026-07-07T00:00:00-07:00'),
    new Date('2026-08-02T23:59:59-07:00'),
  );
  assertArrayLength(selected, 0, 'Strict Product Group posts');
})) passed += 1; else failed += 1;

if (test('Should escape Product Group markup and reject unsafe URLs', () => {
  const unsafeHtml = generateProductGroupHTML([{
    title: '<img src=x onerror=alert(1)>',
    link: 'javascript:alert(1)',
    publishedAt: '2026-01-06',
    summary: '<script>alert(1)</script>',
    imageUrl: 'data:image/png;base64,abc',
  }]);
  const safeHtml = generateProductGroupHTML([{
    title: 'Safe & Sound',
    link: 'https://example.com/article?a=1&b=2',
    publishedAt: '2026-01-06',
    summary: 'Summary & details',
    imageUrl: 'https://example.com/image.png?a=1&b=2',
  }]);

  assertEqual(unsafeHtml.includes('href='), false, 'Unsafe article link');
  assertEqual(unsafeHtml.includes('<img'), false, 'Unsafe image URL');
  assertEqual(unsafeHtml.includes('<table'), false, 'No table wrapper');
  assertEqual(unsafeHtml.includes('<tr>'), false, 'No table rows');
  assertEqual(unsafeHtml.includes('<script>'), false, 'Unsafe summary markup');
  assertEqual(unsafeHtml.includes('&lt;img src=x onerror=alert(1)&gt;'), true, 'Escaped title');
  assertEqual(safeHtml.includes('article?a=1&amp;b=2'), true, 'Escaped link attribute');
  assertEqual(safeHtml.includes('<h5><a href='), true, 'Linked h5 title');
  assertEqual(safeHtml.includes('<p>Summary &amp; details</p>'), true, 'Description paragraph');
  assertEqual(safeHtml.includes('Safe &amp; Sound'), true, 'Escaped title text');
})) passed += 1; else failed += 1;

if (test('Should resolve redirects from the explicit final Page URL', () => {
  const finalUrl = extractFinalPageUrl({
    content: [{
      text: `### Ran Playwright code
await page.goto('https://lnkd.in/original');
### Page
- Page URL: https://example.com/final?source=redirect&mode=test
- Page Title: Final page`,
    }],
  });

  assertEqual(
    finalUrl,
    'https://example.com/final?source=redirect&mode=test',
    'Explicit final URL',
  );
})) passed += 1; else failed += 1;

if (test('Should not treat page.goto input as a final redirect URL', () => {
  const finalUrl = extractFinalPageUrl({
    content: [{
      text: "await page.goto('https://lnkd.in/original');",
    }],
  });
  assertEqual(finalUrl, null, 'Missing explicit final URL');
})) passed += 1; else failed += 1;

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) process.exitCode = 1;
