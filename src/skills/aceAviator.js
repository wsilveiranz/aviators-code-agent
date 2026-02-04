/**
 * Ace Aviator of the Month Skill
 * Extracts Ace Aviator Q&A from email, confirms LinkedIn, generates HTML section.
 */

// Canonical questions for the Q&A
const CANONICAL_QUESTIONS = [
  "What's your role and title? What are your responsibilities?",
  "Can you give us some insights into your day-to-day activities?",
  "What motivates and inspires you to be an active member of the Aviators/Microsoft community?",
  "Looking back, what advice do you wish you had been given earlier?",
  "What has helped you grow professionally?",
  "If you had a magic wand that could create a feature in Logic Apps, what would it be?"
];

/**
 * Parse email body to extract Q&A pairs
 * @param {string} emailBody 
 * @returns {Array<{question: string, answer: string}>}
 */
function parseQAPairs(emailBody) {
  const qaPairs = [];
  const lines = emailBody.split('\n');
  let currentQuestion = null;
  let currentAnswer = [];

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
    let matchedQuestion = null;
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

/**
 * Extract name from email (signature or salutation)
 * @param {string} emailBody 
 * @returns {string|null}
 */
function extractName(emailBody) {
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

/**
 * Extract LinkedIn URL from email
 * @param {string} emailBody 
 * @returns {string|null}
 */
function extractLinkedIn(emailBody) {
  const pattern = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?/gi;
  const matches = emailBody.match(pattern);
  return matches ? matches[0] : null;
}

/**
 * Generate HTML for Ace Aviator section
 * @param {object} data 
 * @returns {string}
 */
function generateHTML({ month, name, linkedin, imageUrl, qaPairs }) {
  let html = `<h1 id="aceaviator">Ace Aviator of the Month</h1>
<p><strong>${month}'s Ace Aviator:&nbsp;${name}</strong></p>`;

  if (imageUrl) {
    html += `\n<li-image src="${imageUrl}" caption="true" width="297" height="297" alt="${name}" align="center">${name}</li-image>`;
  }

  if (linkedin) {
    html += `\n<p>LinkedIn: <a href="${linkedin}" target="_blank" rel="noopener nofollow noreferrer">${linkedin}</a></p>`;
  }

  for (const { question, answer } of qaPairs) {
    html += `\n<h5>${question}</h5>
<p>${answer.replace(/\n/g, '<br>')}</p>`;
  }

  return html;
}

export const aceAviatorSkill = {
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
<p><strong>${month}'s Ace Aviator:&nbsp;${name || 'Unknown'}</strong></p>
<p><em>Error: No Q&A content provided</em></p>`
      };
    }
    
    console.log(`[AceAviator] Generating HTML with ${parsedQA.length} Q&A pairs`);

    // Extract LinkedIn from email if not provided
    const extractedLinkedIn = linkedin || (emailBody ? extractLinkedIn(emailBody) : null);

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

export { CANONICAL_QUESTIONS, parseQAPairs, extractName, extractLinkedIn, generateHTML };
