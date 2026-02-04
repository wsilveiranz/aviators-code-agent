/**
 * Product Group News Skill
 * Crawl Tech Community Integration on Azure, filter by PST window + Logic Apps, generate table rows.
 */

import { computeDateWindow } from './dateWindow.js';

const SOURCE_URL = 'https://techcommunity.microsoft.com/category/azure/blog/integrationsonazureblog';

/**
 * Filter posts by date window (posts from Integrations blog are already relevant)
 * Excludes newsletter posts themselves
 * @param {Array} posts 
 * @param {Date} startDate 
 * @param {Date} endDate 
 * @returns {Array}
 */
function filterPosts(posts, startDate, endDate) {
  console.log(`[ProductGroup] Filtering ${posts.length} posts for window: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  return posts.filter(post => {
    const publishDate = new Date(post.publishedAt);
    const validDate = !isNaN(publishDate.getTime());
    const inWindow = validDate && publishDate >= startDate && publishDate <= endDate;
    const isNewsletter = /logic\s*apps?\s*aviators?\s*newsletter/i.test(post.title);
    
    console.log(`[ProductGroup]   "${post.title}" - date: ${post.publishedAt}, parsed: ${validDate ? publishDate.toISOString() : 'INVALID'}, inWindow: ${inWindow}, isNewsletter: ${isNewsletter}`);
    
    // Include if in date window and NOT a newsletter post
    return inWindow && !isNewsletter;
  });
}

/**
 * Deduplicate posts by URL or title similarity
 * @param {Array} posts 
 * @returns {Array}
 */
function deduplicatePosts(posts) {
  const seen = new Set();
  return posts.filter(post => {
    const key = post.link.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Generate HTML table rows for product group posts
 * @param {Array} posts 
 * @returns {string}
 */
function generateHTML(posts) {
  return posts.map(post => {
    const imageHtml = post.imageUrl 
      ? `<img src="${post.imageUrl}" alt="${post.title}" style="max-width: 200px;">`
      : '';
    
    return `<tr>
  <td>${imageHtml}</td>
  <td>
    <h5><a href="${post.link}" target="_blank" rel="noopener noreferrer">${post.title}</a></h5>
    <p>${post.summary}</p>
  </td>
</tr>`;
  }).join('\n');
}

export const productGroupSkill = {
  name: 'createProductGroupNews',
  description: 'Generate Product Group news section from Tech Community posts. Filters by date window and Logic Apps relevance. Posts should have: title, link, publishedAt (ISO date like "2026-01-28" or "Jan 28, 2026"), summary.',
  parameters: {
    type: 'object',
    properties: {
      month: {
        type: 'string',
        description: 'Month for the newsletter, e.g., "February 2026"'
      },
      posts: {
        type: 'array',
        description: 'Array of post objects with title, link, publishedAt (date string), summary, and optional imageUrl',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Post title' },
            link: { type: 'string', description: 'URL to the post' },
            publishedAt: { type: 'string', description: 'Publication date (e.g., "2026-01-28" or "Jan 28, 2026")' },
            summary: { type: 'string', description: 'Post excerpt/summary' },
            imageUrl: { type: 'string', description: 'Optional image URL' }
          },
          required: ['title', 'link', 'publishedAt']
        }
      }
    },
    required: ['month', 'posts']
  },
  execute: async ({ month, posts }) => {
    console.log(`[ProductGroup] Called with month=${month}, posts=${posts?.length || 0}`);
    
    // Normalize date formats
    const normalizedPosts = posts.map(post => {
      let publishedAt = post.publishedAt || post.date || post.published || '';
      
      // Try to parse various date formats
      if (publishedAt) {
        // Handle "Feb 02, 2026" or "February 2, 2026" format
        const parsed = new Date(publishedAt);
        if (!isNaN(parsed.getTime())) {
          publishedAt = parsed.toISOString().split('T')[0];
        }
      }
      
      return {
        ...post,
        publishedAt,
        summary: post.summary || post.excerpt || post.description || ''
      };
    });

    // Compute date window
    const { startPST, endPST } = computeDateWindow(month);
    const startDate = new Date(startPST);
    const endDate = new Date(endPST);

    // Filter and dedupe
    const filteredPosts = filterPosts(normalizedPosts, startDate, endDate);
    const uniquePosts = deduplicatePosts(filteredPosts);
    
    console.log(`[ProductGroup] Total: ${posts.length}, Filtered: ${filteredPosts.length}, Unique: ${uniquePosts.length}`);

    // Generate HTML
    const html = generateHTML(uniquePosts);

    return {
      success: true,
      month,
      dateWindow: { startPST, endPST },
      sourceUrl: SOURCE_URL,
      totalPosts: posts.length,
      filteredCount: uniquePosts.length,
      posts: uniquePosts,
      html: `<h1 id="productnews">News from our product group</h1>
<table><tbody>
${html}
</tbody></table>`
    };
  }
};

export { SOURCE_URL, filterPosts, deduplicatePosts, generateHTML };
