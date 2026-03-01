/**
 * Community News Skill
 * Build Community section from LinkedIn activity URLs via Playwright scraping.
 */

/**
 * Determine item kind based on URL
 * @param {string} url 
 * @returns {string}
 */
function getItemKind(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) {
    return 'Video';
  }
  return 'Post';
}

/**
 * Validate and filter URLs
 * @param {Array} items 
 * @returns {Array}
 */
function filterValidItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const url = item.externalLink || item.COM_ArticleLink;
    if (!url || !url.startsWith('http')) return false;
    
    // Dedupe by URL
    const normalizedUrl = url.toLowerCase().replace(/\/$/, '');
    if (seen.has(normalizedUrl)) return false;
    seen.add(normalizedUrl);
    
    return true;
  });
}

/**
 * Generate HTML for a single community item
 * @param {object} item 
 * @returns {string}
 */
function generateItemHTML(item) {
  const articleLink = item.externalLink || item.COM_ArticleLink;
  const articleTitle = item.title || item.COM_ArticleTitle || 'Untitled';
  const authorProfile = item.authorProfile || item.COM_LinkedInAuthorProfile || '#';
  const authorName = item.authorName || item.COM_LinkedInAuthorName || 'Unknown Author';
  const summary = item.summary || item.COM_ArticleSummary || '';
  const itemKind = item.itemKind || item.COM_ItemKind || getItemKind(articleLink);

  return `<h5><a href="${articleLink}" target="_blank" rel="noopener noreferrer">${articleTitle}</a></h5>
<p>${itemKind} by <a href="${authorProfile}" target="_blank" rel="noopener nofollow noreferrer"><em>${authorName}</em></a></p>
<p>${summary}</p>`;
}

/**
 * Generate full community section HTML
 * @param {Array} items 
 * @returns {string}
 */
function generateHTML(items) {
  const validItems = filterValidItems(items);
  const itemsHtml = validItems.map(generateItemHTML).join('\n');
  
  return `<h1 id="communitynews">News from our community</h1>
${itemsHtml}`;
}

export const communityNewsSkill = {
  name: 'createCommunityNews',
  description: 'Build Community section from processed LinkedIn activity data. REQUIRES actual scraped data from scrapeLinkedIn tool - do NOT pass fabricated data. When processing batches, pass existingHtml from the previous call to append new items.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Array of community items with externalLink, title, authorProfile, authorName, and summary. Data MUST come from scrapeLinkedIn results.',
        items: {
          type: 'object',
          properties: {
            externalLink: { type: 'string', description: 'URL to the article' },
            title: { type: 'string', description: 'Article title' },
            authorProfile: { type: 'string', description: 'LinkedIn profile URL of the author' },
            authorName: { type: 'string', description: 'Name of the author' },
            summary: { type: 'string', description: '80-100 word summary of the article' },
            itemKind: { type: 'string', description: 'Type of content: Post or Video' }
          }
        }
      },
      existingHtml: {
        type: 'string',
        description: 'HTML from a previous createCommunityNews call. When provided, new items are appended to this section instead of creating a new one. Use this when processing URLs in batches.'
      }
    },
    required: ['items']
  },
  execute: async ({ items, existingHtml }) => {
    // Validate items to detect fabrication
    const FAKE_NAMES = ['john doe', 'jane doe', 'jane smith', 'john smith', 'unknown author', 'example author'];
    const fabricatedItems = items.filter(item => {
      const name = (item.authorName || '').toLowerCase();
      return FAKE_NAMES.includes(name);
    });
    
    if (fabricatedItems.length > 0) {
      console.log(`[CommunityNews] REJECTED: ${fabricatedItems.length} items have fabricated author names`);
      return {
        success: false,
        error: 'Fabricated data detected. You must call scrapeLinkedIn first to get real author data.',
        fabricatedNames: fabricatedItems.map(i => i.authorName),
        html: existingHtml || '<h1 id="communitynews">News from our community</h1>\n<p><em>Error: Please use scrapeLinkedIn to get real data first.</em></p>'
      };
    }
    
    const validItems = filterValidItems(items);

    let html;
    if (existingHtml) {
      // Append mode: add new items to existing section HTML
      const newItemsHtml = validItems.map(generateItemHTML).join('\n');
      html = existingHtml + '\n' + newItemsHtml;
      console.log(`[CommunityNews] Appended ${validItems.length} items to existing section`);
    } else {
      html = generateHTML(items);
      console.log(`[CommunityNews] Created new section with ${validItems.length} items`);
    }

    return {
      success: true,
      totalItems: items.length,
      validItems: validItems.length,
      items: validItems.map(item => ({
        title: item.title || item.COM_ArticleTitle,
        link: item.externalLink || item.COM_ArticleLink,
        author: item.authorName || item.COM_LinkedInAuthorName,
        kind: item.itemKind || item.COM_ItemKind || getItemKind(item.externalLink || item.COM_ArticleLink)
      })),
      html
    };
  }
};

export { getItemKind, filterValidItems, generateItemHTML, generateHTML };
