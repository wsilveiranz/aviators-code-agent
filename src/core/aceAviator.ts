import type { Skill } from './types.js';

import { escapeHtml, toSafeHttpUrl } from './contentSafety.js';

// Canonical questions for the Q&A
export const CANONICAL_QUESTIONS = [
  "What's your role and title? What are your responsibilities?",
  "Can you give us some insights into your day-to-day activities?",
  "What motivates and inspires you to be an active member of the Aviators/Microsoft community?",
  "Looking back, what advice do you wish you had been given earlier?",
  "What has helped you grow professionally?",
  "If you had a magic wand that could create a feature in Logic Apps, what would it be?"
];

export interface QAPair {
  question: string;
  answer: string;
}

export interface AceAviatorParams {
  month: string;
  emailBody?: string;
  qaPairs?: QAPair[];
  name: string;
  linkedin?: string;
  imageUrl?: string;
}

export interface AceAviatorSuccess {
  success: true;
  name: string;
  linkedin: string | null;
  qaPairsCount: number;
  html: string;
  missingLinkedIn: boolean;
}

export interface AceAviatorFailure {
  success: false;
  error: string;
  html: string;
}

interface AceAviatorHtmlData {
  month: string;
  name: string;
  linkedin?: string | null;
  imageUrl?: string;
  qaPairs: QAPair[];
}

export function parseQAPairs(emailBody: string): QAPair[] {
  const qaPairs: QAPair[] = [];
  const lines = emailBody.split('\n');
  let currentQuestion: string | null = null;
  let currentAnswer: string[] = [];

  // Create regex patterns for each canonical question (case-insensitive, tolerant)
  const questionPatterns = CANONICAL_QUESTIONS.map(q => {
    // Escape special regex chars and allow for variations
    const pattern = q
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+')
      .replace(/'/g, "['\u2019]"); // Handle curly quotes
    return new RegExp(pattern, 'i');
  });

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Check if line matches any canonical question
    let matchedQuestion: string | null = null;
    for (let i = 0; i < questionPatterns.length; i++) {
      if (questionPatterns[i].test(trimmedLine)) {
        matchedQuestion = CANONICAL_QUESTIONS[i];
        break;
      }
    }

    if (matchedQuestion) {
      // Save previous Q&A if exists
      if (currentQuestion && currentAnswer.length > 0) {
        qaPairs.push({
          question: currentQuestion,
          answer: currentAnswer.join('\n').trim()
        });
      }
      currentQuestion = matchedQuestion;
      currentAnswer = [];
    } else if (currentQuestion) {
      currentAnswer.push(trimmedLine);
    }
  }

  // Save last Q&A
  if (currentQuestion && currentAnswer.length > 0) {
    qaPairs.push({
      question: currentQuestion,
      answer: currentAnswer.join('\n').trim()
    });
  }

  return qaPairs;
}

export function extractName(emailBody: string): string | null {
  // Look for common patterns
  const patterns = [
    /^Best,?\s*\n+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/m,
    /^Regards,?\s*\n+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/m,
    /^Thanks,?\s*\n+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/m,
    /^Cheers,?\s*\n+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/m,
    /Hi,?\s+I['']?m\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
  ];

  for (const pattern of patterns) {
    const match = emailBody.match(pattern);
    if (match) return match[1];
  }

  return null;
}

export function extractLinkedIn(emailBody: string): string | null {
  const pattern = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?/gi;
  const matches = emailBody.match(pattern);
  return matches ? matches[0] : null;
}

export function generateHTML({
  month,
  name,
  linkedin,
  imageUrl,
  qaPairs,
}: AceAviatorHtmlData): string {
  const escapedMonth = escapeHtml(month);
  const escapedName = escapeHtml(name);
  let html = `<h1 id="aceaviator">Ace Aviator of the Month</h1>
<p><strong>${escapedMonth}'s Ace Aviator:&nbsp;${escapedName}</strong></p>`;

  const safeImageUrl = toSafeHttpUrl(imageUrl);
  if (safeImageUrl) {
    html += `\n<li-image src="${escapeHtml(safeImageUrl)}" caption="true" width="297" height="297" alt="${escapedName}" align="center">${escapedName}</li-image>`;
  }

  const safeLinkedIn = toSafeHttpUrl(linkedin);
  if (safeLinkedIn) {
    const escapedLinkedIn = escapeHtml(safeLinkedIn);
    html += `\n<p>LinkedIn: <a href="${escapedLinkedIn}" target="_blank" rel="noopener nofollow noreferrer">${escapedLinkedIn}</a></p>`;
  }

  for (const { question, answer } of qaPairs) {
    html += `\n<h5>${escapeHtml(question)}</h5>
<p>${escapeHtml(answer).replace(/\r?\n/g, '<br>')}</p>`;
  }

  return html;
}

export const aceAviatorSkill: Skill<
  AceAviatorParams,
  AceAviatorSuccess | AceAviatorFailure
> = {
  name: 'createAceAviator',
  description: 'Generate Ace Aviator HTML section. You can pass either emailBody (skill will try to parse) OR qaPairs (pre-parsed Q&A array - PREFERRED).',
  parameters: {
    type: 'object',
    properties: {
      month: {
        type: 'string',
        description: 'Month for the newsletter, e.g., "February 2026"'
      },
      emailBody: {
        type: 'string',
        description: 'The email body containing Q&A responses (optional if qaPairs provided)'
      },
      qaPairs: {
        type: 'array',
        description: 'Pre-parsed Q&A pairs - PREFERRED over emailBody parsing. Each item has question and answer.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            answer: { type: 'string' }
          }
        }
      },
      name: {
        type: 'string',
        description: 'Full name of the Ace Aviator'
      },
      linkedin: {
        type: 'string',
        description: 'LinkedIn profile URL'
      },
      imageUrl: {
        type: 'string',
        description: 'URL of the profile image (optional)'
      }
    },
    required: ['month', 'name']
  },
  execute: async ({ month, emailBody, qaPairs, name, linkedin, imageUrl }) => {
    console.log(`[AceAviator] Called with: month=${month}, name=${name}, linkedin=${linkedin ? 'yes' : 'no'}, qaPairs=${qaPairs?.length || 0}, emailBody=${emailBody?.length || 0} chars`);
    
    // Use provided qaPairs or try to parse from emailBody
    let parsedQA = qaPairs || [];
    
    if (parsedQA.length === 0 && emailBody) {
      console.log(`[AceAviator] No qaPairs provided, trying to parse from emailBody`);
      parsedQA = parseQAPairs(emailBody);
      console.log(`[AceAviator] Parsed ${parsedQA.length} Q&A pairs from emailBody`);
    }
    
    if (parsedQA.length === 0) {
      console.log(`[AceAviator] ERROR: No Q&A pairs found`);
      return {
        success: false,
        error: 'No Q&A pairs found. Please provide qaPairs array with question/answer objects.',
        html: `<h1 id="aceaviator">Ace Aviator of the Month</h1>
<p><strong>${escapeHtml(month)}'s Ace Aviator:&nbsp;${escapeHtml(name || 'Unknown')}</strong></p>
<p><em>Error: No Q&A content provided</em></p>`
      };
    }
    
    console.log(`[AceAviator] Generating HTML with ${parsedQA.length} Q&A pairs`);

    // Extract LinkedIn from email if not provided
    const extractedLinkedIn = toSafeHttpUrl(
      linkedin || (emailBody ? extractLinkedIn(emailBody) : null),
    );

    // Generate HTML
    const html = generateHTML({
      month,
      name,
      linkedin: extractedLinkedIn,
      imageUrl,
      qaPairs: parsedQA
    });

    console.log(`[AceAviator] Generated HTML: ${html.length} chars`);

    return {
      success: true,
      name,
      linkedin: extractedLinkedIn,
      qaPairsCount: parsedQA.length,
      html,
      missingLinkedIn: !extractedLinkedIn
    };
  }
};
