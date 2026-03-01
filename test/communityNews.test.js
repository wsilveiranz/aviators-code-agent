/**
 * Tests for Community News LinkedIn parsing and HTML generation
 */

import { sampleLinkedInPosts } from './sampleData.js';

/**
 * Generate HTML for a community news item
 */
function generateCommunityItemHtml(item) {
  const { title, author, authorUrl, externalLink, summary } = item;
  
  return `<h5><a href="${externalLink}" target="_blank" rel="noopener noreferrer">${title}</a></h5>
<p><strong>Posted by:</strong> <a href="${authorUrl}" target="_blank">${author}</a></p>
<p>${summary}</p>`;
}

/**
 * Extract article info from LinkedIn post
 */
function extractLinkedArticle(post) {
  if (post.linkedArticle) {
    return {
      title: post.linkedArticle.title,
      url: post.linkedArticle.url
    };
  }
  return null;
}

/**
 * Transform scraped LinkedIn data into community news items
 */
function transformLinkedInPosts(posts) {
  return posts.map(post => {
    const article = extractLinkedArticle(post);
    return {
      author: post.author,
      authorUrl: post.authorUrl,
      linkedInUrl: post.url,
      externalLink: article?.url || post.url,
      title: article?.title || `Post by ${post.author}`,
      content: post.content,
      hasArticle: !!article
    };
  });
}

// ========== TESTS ==========

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    return false;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertTrue(actual, message) {
  if (!actual) {
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertArrayLength(arr, expected, message) {
  if (!Array.isArray(arr)) {
    throw new Error(`${message}: expected array`);
  }
  if (arr.length !== expected) {
    throw new Error(`${message}: expected ${expected} items, got ${arr.length}`);
  }
}

console.log('\n=== Community News LinkedIn Parsing Tests ===\n');

let passed = 0;
let failed = 0;

const posts = sampleLinkedInPosts.posts;

// Test 1: Transform LinkedIn posts
if (test('Should transform LinkedIn posts to community items', () => {
  const items = transformLinkedInPosts(posts);
  assertArrayLength(items, 3, 'Should have 3 items');
})) passed++; else failed++;

// Test 2: Extract linked article
if (test('Should extract linked article from post', () => {
  const article = extractLinkedArticle(posts[0]);
  assertTrue(article, 'Should have article');
  assertEqual(article.title, 'Azure Integrations That Actually Work in Production', 'Article title');
})) passed++; else failed++;

// Test 3: Handle post without linked article
if (test('Should handle post without linked article', () => {
  const article = extractLinkedArticle(posts[2]);
  assertEqual(article, null, 'Should be null for post without article');
})) passed++; else failed++;

// Test 4: Use article URL as external link when available
if (test('Should use article URL as external link', () => {
  const items = transformLinkedInPosts(posts);
  assertEqual(
    items[0].externalLink,
    'https://www.linkedin.com/pulse/azure-integrations-actually-work-production-devarajan-gurusamy',
    'External link should be article URL'
  );
})) passed++; else failed++;

// Test 5: Fall back to LinkedIn URL when no article
if (test('Should fall back to LinkedIn URL when no article', () => {
  const items = transformLinkedInPosts(posts);
  assertEqual(
    items[2].externalLink,
    'https://www.linkedin.com/feed/update/urn:li:activity:7419768336500150273/',
    'External link should be LinkedIn URL'
  );
})) passed++; else failed++;

// Test 6: Generate valid HTML
if (test('Should generate valid HTML for community item', () => {
  const items = transformLinkedInPosts(posts);
  const html = generateCommunityItemHtml({
    title: items[0].title,
    author: items[0].author,
    authorUrl: items[0].authorUrl,
    externalLink: items[0].externalLink,
    summary: 'Test summary'
  });
  assertTrue(html.includes('<h5>'), 'Should have h5 tag');
  assertTrue(html.includes('Devarajan Gurusamy'), 'Should have author name');
  assertTrue(html.includes('target="_blank"'), 'Should have target blank');
})) passed++; else failed++;

// Test 7: Preserve author information
if (test('Should preserve author information', () => {
  const items = transformLinkedInPosts(posts);
  assertEqual(items[1].author, 'Stephen Thomas', 'Second author');
  assertTrue(items[1].authorUrl.includes('stephenwthomas'), 'Author URL');
})) passed++; else failed++;

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

// ========== BATCH & APPEND MODE TESTS ==========
// These test the communityNews skill's append behavior

import { communityNewsSkill, generateItemHTML } from '../src/skills/communityNews.js';

console.log('\n=== Community News Batch & Append Tests ===\n');

let passed2 = 0;
let failed2 = 0;

const sampleItems = [
  {
    externalLink: 'https://example.com/article1',
    title: 'Article One',
    authorProfile: 'https://linkedin.com/in/author1',
    authorName: 'Author One',
    summary: 'Summary of article one.',
    itemKind: 'Post'
  },
  {
    externalLink: 'https://example.com/article2',
    title: 'Article Two',
    authorProfile: 'https://linkedin.com/in/author2',
    authorName: 'Author Two',
    summary: 'Summary of article two.',
    itemKind: 'Video'
  }
];

const sampleItems2 = [
  {
    externalLink: 'https://example.com/article3',
    title: 'Article Three',
    authorProfile: 'https://linkedin.com/in/author3',
    authorName: 'Author Three',
    summary: 'Summary of article three.',
    itemKind: 'Post'
  }
];

// Test: First batch creates section with header
if (await (async () => {
  try {
    const result = await communityNewsSkill.execute({ items: sampleItems });
    assertTrue(result.success, 'Should succeed');
    assertTrue(result.html.includes('<h1 id="communitynews">'), 'Should have section header');
    assertTrue(result.html.includes('Article One'), 'Should have first article');
    assertTrue(result.html.includes('Article Two'), 'Should have second article');
    assertEqual(result.validItems, 2, 'Should have 2 valid items');
    console.log('✓ First batch creates section with header');
    return true;
  } catch (err) {
    console.log(`✗ First batch creates section with header\n  Error: ${err.message}`);
    return false;
  }
})()) passed2++; else failed2++;

// Test: Append mode adds items without duplicating header
if (await (async () => {
  try {
    const firstResult = await communityNewsSkill.execute({ items: sampleItems });
    const appendResult = await communityNewsSkill.execute({ items: sampleItems2, existingHtml: firstResult.html });
    assertTrue(appendResult.success, 'Should succeed');
    // Should have exactly ONE h1 header (from existing, not duplicated)
    const h1Count = (appendResult.html.match(/<h1 id="communitynews">/g) || []).length;
    assertEqual(h1Count, 1, 'Should have exactly one section header');
    // Should have all 3 articles
    assertTrue(appendResult.html.includes('Article One'), 'Should keep first article');
    assertTrue(appendResult.html.includes('Article Two'), 'Should keep second article');
    assertTrue(appendResult.html.includes('Article Three'), 'Should have new article');
    console.log('✓ Append mode adds items without duplicating header');
    return true;
  } catch (err) {
    console.log(`✗ Append mode adds items without duplicating header\n  Error: ${err.message}`);
    return false;
  }
})()) passed2++; else failed2++;

// Test: Append mode returns correct item count for current batch only
if (await (async () => {
  try {
    const firstResult = await communityNewsSkill.execute({ items: sampleItems });
    const appendResult = await communityNewsSkill.execute({ items: sampleItems2, existingHtml: firstResult.html });
    assertEqual(appendResult.validItems, 1, 'Should report 1 new valid item');
    assertEqual(appendResult.totalItems, 1, 'Should report 1 total item in this batch');
    console.log('✓ Append mode returns correct item count for current batch');
    return true;
  } catch (err) {
    console.log(`✗ Append mode returns correct item count for current batch\n  Error: ${err.message}`);
    return false;
  }
})()) passed2++; else failed2++;

// Test: Fabrication detection still works in append mode
if (await (async () => {
  try {
    const firstResult = await communityNewsSkill.execute({ items: sampleItems });
    const fakeItems = [{ externalLink: 'https://example.com/fake', title: 'Fake', authorName: 'John Doe', authorProfile: '#', summary: 'Fake', itemKind: 'Post' }];
    const appendResult = await communityNewsSkill.execute({ items: fakeItems, existingHtml: firstResult.html });
    assertEqual(appendResult.success, false, 'Should reject fabricated data');
    // Existing HTML should be preserved in error response
    assertTrue(appendResult.html.includes('Article One'), 'Should preserve existing HTML on error');
    console.log('✓ Fabrication detection works in append mode');
    return true;
  } catch (err) {
    console.log(`✗ Fabrication detection works in append mode\n  Error: ${err.message}`);
    return false;
  }
})()) passed2++; else failed2++;

console.log(`\n=== Results: ${passed2} passed, ${failed2} failed ===\n`);

if (failed > 0 || failed2 > 0) process.exit(1);
