export type NewsletterSection = 'aceAviator' | 'productGroup' | 'community';

export interface NewsletterSections {
  toc: string;
  aceAviator: string;
  productGroup: string;
  community: string;
}

export type AceAviatorQuestionKey =
  | 'role'
  | 'daytoday'
  | 'motivation'
  | 'advice'
  | 'growth'
  | 'magicwand';

export interface AceAviatorQuestion {
  key: AceAviatorQuestionKey;
  patterns: RegExp[];
}

export interface AceAviatorQA {
  question: string;
  answer: string;
}

type PropertyContainer = Record<string, unknown>;

function isPropertyContainer(value: unknown): value is PropertyContainer {
  return (
    (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
  );
}

function getProperty(value: unknown, key: string): unknown {
  return isPropertyContainer(value) ? value[key] : undefined;
}

export const ACE_AVIATOR_QUESTIONS: AceAviatorQuestion[] = [
  { key: 'role', patterns: [/what'?s your role/i, /what are your responsibilities/i, /role and title/i] },
  { key: 'daytoday', patterns: [/day-to-day/i, /typical day/i, /insights into your/i, /daily activities/i] },
  { key: 'motivation', patterns: [/what motivates/i, /what inspires/i, /active member/i, /aviators.*community/i] },
  { key: 'advice', patterns: [/looking back/i, /what advice/i, /wish you had been given/i, /earlier.*share/i] },
  { key: 'growth', patterns: [/helped you grow/i, /grow professionally/i, /professional growth/i] },
  { key: 'magicwand', patterns: [/magic wand/i, /create a feature/i, /feature in logic apps/i] },
];

export function parseAceAviatorQA(body: string): AceAviatorQA[] {
  const qa: AceAviatorQA[] = [];
  const text = body.replace(/\r\n/g, '\n');
  const questionPositions: Array<{
    key: string;
    question: string;
    start: number;
    end: number;
  }> = [];

  for (const question of ACE_AVIATOR_QUESTIONS) {
    for (const pattern of question.patterns) {
      const match = text.match(pattern);
      if (!match || match.index === undefined) {
        continue;
      }

      let lineStart = text.lastIndexOf('\n', match.index);
      lineStart = lineStart === -1 ? 0 : lineStart + 1;

      let lineEnd = text.indexOf('\n', match.index);
      if (lineEnd === -1) {
        lineEnd = text.length;
      }

      const questionText = text
        .substring(lineStart, lineEnd)
        .trim()
        .replace(/^\d+\.\s*/, '')
        .replace(/^[-*•]\s*/, '');

      questionPositions.push({
        key: question.key,
        question: questionText,
        start: lineStart,
        end: lineEnd,
      });
      break;
    }
  }

  questionPositions.sort((a, b) => a.start - b.start);

  for (let index = 0; index < questionPositions.length; index += 1) {
    const current = questionPositions[index];
    const next = questionPositions[index + 1];
    const answer = text
      .substring(current.end + 1, next ? next.start : text.length)
      .trim()
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s*\n/, '')
      .trim();

    if (answer.length > 10) {
      qa.push({ question: current.question, answer });
    }
  }

  return qa;
}

export function summarizeToolResult(result: unknown): string | undefined {
  if (!result) {
    return JSON.stringify(result);
  }

  const str = typeof result === 'string' ? result : JSON.stringify(result);
  let parsed: unknown = result;
  if (typeof result === 'string') {
    try {
      parsed = JSON.parse(result) as unknown;
    } catch {
      parsed = null;
    }
  }

  const emails = getProperty(parsed, 'emails');
  if (Array.isArray(emails)) {
    const summarizedEmails = emails.map((email) => {
      const body = getProperty(email, 'body');
      let plainBody = typeof body === 'string' ? body : '';
      const looksLikeHtml =
        plainBody.includes('<html') ||
        plainBody.includes('<body') ||
        plainBody.includes('<div') ||
        plainBody.includes('<p>') ||
        plainBody.includes('<table') ||
        plainBody.includes('<br');

      if (looksLikeHtml && plainBody) {
        plainBody = plainBody
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<img[^>]*src=["']cid:[^"']*["'][^>]*>/gi, '')
          .replace(/<img[^>]*>/gi, '')
          .replace(/<div[^>]*class=["'][^"']*signature[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
          .replace(/Title:\s*\w+\s*-\s*Description:[^\n]*/gi, '')
          .replace(/<[^>]*data-outlook[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<\/div>/gi, '\n')
          .replace(/<\/tr>/gi, '\n')
          .replace(/<\/li>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        const signaturePatterns = [
          /\n\s*(Best regards|Kind regards|Regards|Thanks|Cheers|Sincerely),?\s*\n[\s\S]*$/i,
          /\n\s*-{2,}\s*\n[\s\S]*$/,
        ];

        for (const pattern of signaturePatterns) {
          const match = plainBody.match(pattern);
          if (match?.index && match.index > plainBody.length * 0.5) {
            plainBody = plainBody.substring(0, match.index).trim();
            break;
          }
        }

        plainBody = plainBody
          .replace(/\n\s*\n\s*\n/g, '\n\n')
          .replace(/  +/g, ' ')
          .replace(/Description automatically generated[^\n]*/gi, '')
          .trim();

        console.log(`[API] Converted HTML email to plain text: ${plainBody.length} chars`);
      }

      return {
        subject: getProperty(email, 'subject'),
        from: getProperty(email, 'from'),
        receivedDateTime: getProperty(email, 'receivedDateTime'),
        body: plainBody,
      };
    });

    return JSON.stringify({ success: true, emails: summarizedEmails }, null, 2);
  }

  if (
    isPropertyContainer(parsed) &&
    (parsed.posts ||
      parsed.filteredCount !== undefined ||
      parsed.matchingPosts !== undefined)
  ) {
    const posts = Array.isArray(parsed.posts)
      ? parsed.posts.slice(0, 10).map((post) => {
          const url = getProperty(post, 'url');
          const link = getProperty(post, 'link');
          const date = getProperty(post, 'date');
          const publishedAt = getProperty(post, 'publishedAt');
          return {
            title: getProperty(post, 'title'),
            url: url || link,
            link: link || url,
            date: date || publishedAt,
            publishedAt: publishedAt || date,
          };
        })
      : undefined;
    const summarized: Record<string, unknown> = {
      success: parsed.success,
      filteredCount: parsed.filteredCount,
      matchingPosts: parsed.matchingPosts,
      totalPosts: parsed.totalPosts,
      totalFound: parsed.totalFound,
      month: parsed.month,
      dateWindow: parsed.dateWindow,
      html: parsed.html,
      posts,
      message: parsed.message,
      error: parsed.error,
    };

    for (const key of Object.keys(summarized)) {
      if (summarized[key] === undefined) {
        delete summarized[key];
      }
    }

    return JSON.stringify(summarized, null, 2);
  }

  if (isPropertyContainer(parsed) && Array.isArray(parsed.content)) {
    const content = parsed.content.map((item) => {
      const type = getProperty(item, 'type');
      const text = getProperty(item, 'text');
      if (
        isPropertyContainer(item) &&
        type === 'text' &&
        typeof text === 'string' &&
        text.length > 40000
      ) {
        return { ...item, text: `${text.substring(0, 40000)}\n[... truncated ...]` };
      }
      return item;
    });
    return JSON.stringify({ ...parsed, content }, null, 2);
  }

  if (str !== undefined && str.length > 50000) {
    return `${str.substring(0, 50000)}\n[... truncated ...]`;
  }

  return str;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage?: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(errorMessage || `Operation timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

export const NEWSLETTER_TEMPLATE: NewsletterSections = {
  toc: `<p><strong>In this issue:</strong></p>
<ul>
  <li><a href="#aceaviator">Ace Aviator of the Month</a></li>
  <li><a href="#productnews">News from our product group</a></li>
  <li><a href="#communitynews">News from our community</a></li>
</ul>
<hr>`,
  aceAviator:
    '<h1 id="aceaviator">Ace Aviator of the Month</h1>\n<p><em>&lt;TODO: Generate Ace Aviator section&gt;</em></p>\n<hr>',
  productGroup:
    '<h1 id="productnews">News from our product group</h1>\n<p><em>&lt;TODO: Generate Product Group section&gt;</em></p>\n<hr>',
  community:
    '<h1 id="communitynews">News from our community</h1>\n<p><em>&lt;TODO: Generate Community section&gt;</em></p>',
};

export function detectSection(html: string): NewsletterSection | null {
  if (!html.includes('<')) {
    return null;
  }

  const hasAceAviator =
    /id="aceaviator"/i.test(html) || /<h1[^>]*>.*ace\s*aviator/i.test(html);
  const hasProductGroup =
    /id="productnews"/i.test(html) ||
    /<h1[^>]*>.*product\s*(group|news)|<h1[^>]*>.*news from our product/i.test(html);
  const hasCommunity =
    /id="communitynews"/i.test(html) ||
    /<h1[^>]*>.*community|<h1[^>]*>.*news from our community/i.test(html);

  const sectionCount = [hasAceAviator, hasProductGroup, hasCommunity].filter(Boolean).length;
  if (sectionCount > 1) {
    console.log(
      `[API] Rejected multi-section HTML (${sectionCount} different sections detected)`,
    );
    return null;
  }

  if (hasAceAviator) return 'aceAviator';
  if (hasProductGroup) return 'productGroup';
  if (hasCommunity) return 'community';
  return null;
}

export function buildNewsletter(sections: NewsletterSections): string {
  return [
    sections.toc,
    sections.aceAviator,
    sections.productGroup,
    sections.community,
  ].join('\n');
}
