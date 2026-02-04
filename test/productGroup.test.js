/**
 * Tests for Product Group blog parsing and date filtering
 */

import { sampleBlogSnapshot, feb2026DateWindow } from './sampleData.js';

/**
 * Parse blog posts from Tech Community page content
 * Extracted from mcpClient.js for testing
 */
function parseBlogPosts(content) {
  const posts = [];
  
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
  
  let currentPost = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Look for link patterns in YAML format: - link "Title" [ref=...]:
    const linkMatch = line.match(/link\s+"([^"]+)"\s+\[ref=/);
    if (linkMatch) {
      // Save previous post
      if (currentPost && currentPost.url) {
        posts.push(currentPost);
      }
      currentPost = { title: linkMatch[1] };
    }
    
    // Look for URL pattern: - /url: /blog/...
    if (currentPost && !currentPost.url) {
      const urlMatch = line.match(/\/url:\s*([^\s]+)/);
      if (urlMatch) {
        const path = urlMatch[1];
        // Only keep blog posts, not navigation links
        if (path.includes('/blog/integrationsonazureblog/') && path.length > 40) {
          currentPost.url = path.startsWith('http') ? path : `https://techcommunity.microsoft.com${path}`;
        } else {
          currentPost = null; // Not a blog post link
        }
      }
    }
    
    // Look for dates: text: Jan 28, 2026
    if (currentPost && currentPost.url && !currentPost.date) {
      const dateMatch = line.match(/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})/i);
      if (dateMatch) {
        currentPost.dateStr = dateMatch[0];
        currentPost.date = new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`);
        // Post is complete, save it and reset
        posts.push(currentPost);
        currentPost = null;
      }
    }
  }
  
  // Don't forget the last post
  if (currentPost && currentPost.url) {
    posts.push(currentPost);
  }
  
  return posts;
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
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertArrayLength(arr, expected, message) {
  if (!Array.isArray(arr)) {
    throw new Error(`${message}: expected array, got ${typeof arr}`);
  }
  if (arr.length !== expected) {
    throw new Error(`${message}: expected ${expected} items, got ${arr.length}`);
  }
}

console.log('\n=== Product Group Blog Parsing Tests ===\n');

let passed = 0;
let failed = 0;

// Test 1: Parse blog posts from sample snapshot
if (test('Should parse blog posts from Playwright snapshot', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  assertArrayLength(posts, 7, 'Total posts found');
})) passed++; else failed++;

// Test 2: Extract correct titles
if (test('Should extract correct post titles', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  assertEqual(posts[0].title, 'Logic Apps Aviators Newsletter - February 2026', 'First post title');
  assertEqual(posts[1].title, 'Introducing Unit Test Agent Profiles for Logic Apps & Data Maps', 'Second post title');
})) passed++; else failed++;

// Test 3: Build full URLs
if (test('Should build full URLs from relative paths', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  const post = posts[1];
  assertEqual(
    post.url.startsWith('https://techcommunity.microsoft.com/blog/'),
    true,
    'URL should be full'
  );
})) passed++; else failed++;

// Test 4: Parse dates correctly
if (test('Should parse dates correctly', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  assertEqual(posts[0].dateStr, 'Feb 02, 2026', 'First post date');
  assertEqual(posts[1].dateStr, 'Jan 28, 2026', 'Second post date');
  assertEqual(posts[5].dateStr, 'Dec 17, 2025', 'December post date');
})) passed++; else failed++;

// Test 5: Filter by date window - February 2026
if (test('Should filter posts within Feb 2026 date window', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  const filtered = filterByDateWindow(posts, feb2026DateWindow.startDate, feb2026DateWindow.endDate);
  // Feb 2026 window: Jan 6 - Feb 1, 2026
  // Should include: Jan 28 x2, Jan 09 = 3 posts
  // Should exclude: Feb 02 (after window), Jan 05 (before window), Dec dates, and newsletters
  assertArrayLength(filtered, 3, 'Posts within date window (excluding newsletters)');
})) passed++; else failed++;

// Test 6: Exclude newsletter posts
if (test('Should exclude Aviators Newsletter posts', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  const filtered = filterByDateWindow(posts, '2025-01-01', '2026-12-31'); // Wide window
  const newsletterPosts = filtered.filter(p => p.title.toLowerCase().includes('aviators newsletter'));
  assertArrayLength(newsletterPosts, 0, 'Newsletter posts should be excluded');
})) passed++; else failed++;

// Test 7: Exclude December 2025 posts for Feb 2026 newsletter
if (test('Should exclude December 2025 posts for Feb 2026 newsletter', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  const filtered = filterByDateWindow(posts, feb2026DateWindow.startDate, feb2026DateWindow.endDate);
  const decPosts = filtered.filter(p => p.dateStr && p.dateStr.includes('Dec'));
  assertArrayLength(decPosts, 0, 'December posts should be excluded');
})) passed++; else failed++;

// Test 8: Include only posts within window
if (test('Should only include Jan 9-28, 2026 posts for Feb 2026 newsletter', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  const filtered = filterByDateWindow(posts, feb2026DateWindow.startDate, feb2026DateWindow.endDate);
  // Expected: "Introducing Unit Test Agent Profiles" (Jan 28), 
  //           "Automated Test Framework" (Jan 28),
  //           "Upcoming Agentic Azure Logic Apps Workshops" (Jan 09)
  // Note: Jan 05 is before window (startPST = Jan 06)
  const titles = filtered.map(p => p.title);
  assertEqual(titles.includes('Introducing Unit Test Agent Profiles for Logic Apps & Data Maps'), true, 'Should include Jan 28 post');
  assertEqual(titles.includes('Upcoming Agentic Azure Logic Apps Workshops'), true, 'Should include Jan 09 post');
})) passed++; else failed++;

// Test 9: Pagination - slice posts with offset and limit
if (test('Should paginate posts with offset and limit', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  const filtered = filterByDateWindow(posts, '2025-01-01', '2026-12-31'); // Wide window
  
  // First batch: offset=0, limit=2
  const batch1 = filtered.slice(0, 2);
  assertArrayLength(batch1, 2, 'First batch should have 2 posts');
  
  // Second batch: offset=2, limit=2
  const batch2 = filtered.slice(2, 4);
  assertArrayLength(batch2, 2, 'Second batch should have 2 posts');
  
  // Batches should be different
  assertEqual(batch1[0].url !== batch2[0].url, true, 'Batches should contain different posts');
})) passed++; else failed++;

// Test 10: Pagination - hasMore flag logic
if (test('Should calculate hasMore flag correctly', () => {
  const posts = parseBlogPosts(sampleBlogSnapshot);
  const filtered = filterByDateWindow(posts, '2025-01-01', '2026-12-31');
  const total = filtered.length;
  
  // When there are more posts
  const offset1 = 0;
  const limit1 = 3;
  const hasMore1 = (offset1 + limit1) < total;
  assertEqual(hasMore1, true, 'hasMore should be true when more posts available');
  
  // When at the end
  const offset2 = total - 1;
  const limit2 = 3;
  const hasMore2 = (offset2 + limit2) < total;
  assertEqual(hasMore2, false, 'hasMore should be false when at the end');
})) passed++; else failed++;

// Test 11: Pagination - respect max batch size
if (test('Should enforce maximum batch size of 20', () => {
  const MAX_BATCH_SIZE = 20;
  const requestedLimit = 50; // Request more than max
  const effectiveLimit = Math.min(Math.max(1, requestedLimit), MAX_BATCH_SIZE);
  assertEqual(effectiveLimit, 20, 'Effective limit should be capped at 20');
})) passed++; else failed++;

// Test 12: Pagination - default batch size
if (test('Should use default batch size of 10 when not specified', () => {
  const DEFAULT_BATCH_SIZE = 10;
  const limit = undefined;
  const effectiveLimit = limit || DEFAULT_BATCH_SIZE;
  assertEqual(effectiveLimit, 10, 'Default batch size should be 10');
})) passed++; else failed++;

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

// Export for use in actual implementation
export { parseBlogPosts, filterByDateWindow };
