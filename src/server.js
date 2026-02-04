/**
 * Backend API Server for the Newsletter Agent UI
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { AzureOpenAI } from 'openai';
import { 
  agentConfig, 
  getSkillDefinitions, 
  getToolDefinitions,
  executeSkill,
  executeTool,
  getNewsletterTemplate
} from './agent.js';
import { 
  connectToPlaywrightMCP, 
  disconnectMCP, 
  listMCPTools, 
  connectToEmailMCP, 
  disconnectEmailMCP, 
  listEmailMCPTools, 
  isStorageValid, 
  runLinkedInLogin,
  callMCPTool
} from './tools/index.js';
import { detectRequiredSkills, buildDynamicPrompt } from './prompts/skillPrompts.js';

// Directory for persisted newsletters
const SAVE_DIR = path.join(process.cwd(), 'saved');
if (!fs.existsSync(SAVE_DIR)) {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Azure OpenAI configuration (loaded from .env)
const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://ws-open-ai.cognitiveservices.azure.com/';
const AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';
const AZURE_MODEL = process.env.AZURE_OPENAI_MODEL || 'gpt-5-2';

if (!AZURE_API_KEY) {
  console.error('ERROR: AZURE_OPENAI_API_KEY not set. Create a .env file with your API key.');
  process.exit(1);
}

const client = new AzureOpenAI({
  endpoint: AZURE_ENDPOINT,
  apiKey: AZURE_API_KEY,
  apiVersion: AZURE_API_VERSION
});

// Store conversation history per session
const sessions = new Map();

// Base system prompt (lightweight - skills loaded on demand)
const BASE_SYSTEM_PROMPT = `You are the ${agentConfig.name}.

${agentConfig.description}

## Newsletter Structure
1. Table of Contents
2. Ace Aviator of the Month - Q&A interview with featured community member
3. News from Product Group - Tech Community blog posts about Logic Apps
4. News from Community - Community-contributed articles and videos

## SEQUENTIAL PROCESSING
When creating multiple sections, process them ONE AT A TIME in order:
1. Complete Ace Aviator fully, then move to Product Group
2. Complete Product Group fully, then move to Community News
3. Do NOT start the next section until the current one is done
4. If user requests all sections in one prompt, complete ALL of them sequentially - do not stop after the first one
5. After completing each section, briefly confirm completion before starting the next

## SCOPE GUARDRAIL
- Execute ALL section(s) the user requests
- If user provides instructions for multiple sections, complete them all in order
- If user says "create the full newsletter", do all sections sequentially

## ANTI-FABRICATION GUARDRAIL - ABSOLUTE RULE
**NEVER FABRICATE CONTENT. This is a hard requirement.**
- Product Group: ONLY use actual blog post data from getTechCommunityBlogPosts or playwright_navigate results
- Community News: ONLY use actual data from scrapeLinkedIn results
- If a tool fails, returns empty, or times out: report the failure to user, DO NOT make up content
- NEVER invent author names like "John Doe" or "Jane Smith"
- NEVER invent post titles or summaries
- If you cannot get real data, leave the section empty or ask the user for help
- Empty tables or "No posts found" is ALWAYS better than fabricated content

## CRITICAL RULES
- ALWAYS compute the date window FIRST when working on Product Group or Community sections
- Date window for "February 2026" = Jan 6, 2026 00:00 PST to Feb 1, 2026 23:59 PST
- Only include content published WITHIN the date window
- If playwright_navigate times out or fails, STOP and ask user for URLs. DO NOT fabricate content.
- ${agentConfig.guardrails.join('. ')}

When generating newsletter sections, always return the HTML in a code block with \`\`\`html markers so the UI can extract and preview it.

## Available Skills
- **Ace Aviator**: Create Q&A section from email (uses parsedQA from email result)
- **Product Group**: Scrape Tech Community blog posts (or accept URLs directly if scraping fails)
- **Community News**: Process LinkedIn activity URLs - MUST use scrapeLinkedIn tool
- **Date Window**: Calculate PST date range for the newsletter month

## Handling Failures
If web scraping times out or returns empty:
1. Tell user: "Could not retrieve content from [source]"
2. Ask: "Please provide the data directly, or I can retry"
3. Wait for user response - DO NOT FABRICATE
`;

// Get tool definitions for OpenAI
function getFunctionDefinitions() {
  const skills = getSkillDefinitions().map(s => ({
    type: 'function',
    function: {
      name: s.name,
      description: s.description,
      parameters: s.parameters
    }
  }));
  
  const tools = getToolDefinitions().map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
  
  return [...skills, ...tools];
}

// Truncate messages to stay within token limits
// Rough estimate: 4 chars per token, keep under 200k tokens (~800k chars)
const MAX_CONTEXT_CHARS = 600000;

function truncateMessages(messages) {
  let totalChars = 0;
  const truncated = [];
  
  // Always keep the most recent messages, work backwards
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const msgChars = content?.length || 0;
    
    if (totalChars + msgChars > MAX_CONTEXT_CHARS) {
      console.log(`[API] Truncating context: keeping ${truncated.length} of ${messages.length} messages`);
      break;
    }
    
    totalChars += msgChars;
    truncated.unshift(msg);
  }
  
  return truncated;
}

// Canonical questions for Ace Aviator Q&A parsing
const ACE_AVIATOR_QUESTIONS = [
  { key: 'role', patterns: [/what'?s your role/i, /what are your responsibilities/i, /role and title/i] },
  { key: 'daytoday', patterns: [/day-to-day/i, /typical day/i, /insights into your/i, /daily activities/i] },
  { key: 'motivation', patterns: [/what motivates/i, /what inspires/i, /active member/i, /aviators.*community/i] },
  { key: 'advice', patterns: [/looking back/i, /what advice/i, /wish you had been given/i, /earlier.*share/i] },
  { key: 'growth', patterns: [/helped you grow/i, /grow professionally/i, /professional growth/i] },
  { key: 'magicwand', patterns: [/magic wand/i, /create a feature/i, /feature in logic apps/i] }
];

// Parse Q&A from Ace Aviator email body
function parseAceAviatorQA(body) {
  const qa = [];
  const text = body.replace(/\r\n/g, '\n');
  
  // Find all question positions
  const questionPositions = [];
  
  for (const q of ACE_AVIATOR_QUESTIONS) {
    for (const pattern of q.patterns) {
      const match = text.match(pattern);
      if (match) {
        // Find the start of the line containing the question
        let lineStart = text.lastIndexOf('\n', match.index);
        if (lineStart === -1) lineStart = 0;
        else lineStart += 1;
        
        // Find the end of the question (next newline or end of sentence)
        let lineEnd = text.indexOf('\n', match.index);
        if (lineEnd === -1) lineEnd = text.length;
        
        // Extract the full question text
        let questionText = text.substring(lineStart, lineEnd).trim();
        
        // Clean up the question
        questionText = questionText.replace(/^\d+\.\s*/, ''); // Remove numbering
        questionText = questionText.replace(/^[-*•]\s*/, ''); // Remove bullets
        
        questionPositions.push({
          key: q.key,
          question: questionText,
          start: lineStart,
          end: lineEnd
        });
        break; // Only use first match per question
      }
    }
  }
  
  // Sort by position
  questionPositions.sort((a, b) => a.start - b.start);
  
  // Extract answers (text between questions)
  for (let i = 0; i < questionPositions.length; i++) {
    const current = questionPositions[i];
    const next = questionPositions[i + 1];
    
    let answerStart = current.end + 1;
    let answerEnd = next ? next.start : text.length;
    
    let answer = text.substring(answerStart, answerEnd).trim();
    
    // Clean up answer - remove embedded questions, trailing signatures
    answer = answer
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s*\n/, '')
      .trim();
    
    if (answer.length > 10) {
      qa.push({
        question: current.question,
        answer: answer
      });
    }
  }
  
  return qa;
}

// Summarize tool results to reduce token usage
function summarizeToolResult(result) {
  if (!result) return JSON.stringify(result);
  
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  const parsed = typeof result === 'string' ? (() => { try { return JSON.parse(result); } catch { return null; } })() : result;
  
  // ALWAYS process email results to clean HTML and parse Q&A
  if (parsed && parsed.emails && Array.isArray(parsed.emails)) {
    const summarizedEmails = parsed.emails.map(email => {
      let plainBody = email.body || '';
      
      // Convert HTML to plain text - detect HTML by looking for HTML tags
      const looksLikeHtml = plainBody.includes('<html') || plainBody.includes('<body') || 
                            plainBody.includes('<div') || plainBody.includes('<p>') ||
                            plainBody.includes('<table') || plainBody.includes('<br');
      
      if (looksLikeHtml && plainBody) {
        // Remove unwanted elements first
        plainBody = plainBody
          // Remove style and script blocks
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          // Remove images with CID references (embedded images)
          .replace(/<img[^>]*src=["']cid:[^"']*["'][^>]*>/gi, '')
          // Remove all img tags (often signatures/logos)
          .replace(/<img[^>]*>/gi, '')
          // Remove signature blocks (common patterns)
          .replace(/<div[^>]*class=["'][^"']*signature[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
          // Remove email metadata like "Title: LinkedIn - Description:"
          .replace(/Title:\s*\w+\s*-\s*Description:[^\n]*/gi, '')
          // Remove outlook-specific elements
          .replace(/<[^>]*data-outlook[^>]*>[\s\S]*?<\/[^>]+>/gi, '');
        
        // Convert structure to plain text
        plainBody = plainBody
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
        
        // Clean up the signature section at the end
        // Look for common signature patterns and truncate
        const signaturePatterns = [
          /\n\s*(Best regards|Kind regards|Regards|Thanks|Cheers|Sincerely),?\s*\n[\s\S]*$/i,
          /\n\s*-{2,}\s*\n[\s\S]*$/,  // Lines starting with --
        ];
        
        for (const pattern of signaturePatterns) {
          const match = plainBody.match(pattern);
          if (match && match.index && match.index > plainBody.length * 0.5) {
            plainBody = plainBody.substring(0, match.index).trim();
            break;
          }
        }
        
        // Final cleanup
        plainBody = plainBody
          .replace(/\n\s*\n\s*\n/g, '\n\n')
          .replace(/  +/g, ' ')
          .replace(/Description automatically generated[^\n]*/gi, '')
          .trim();
          
        console.log(`[API] Converted HTML email to plain text: ${plainBody.length} chars`);
      }
      
      return {
        subject: email.subject,
        from: email.from,
        receivedDateTime: email.receivedDateTime,
        body: plainBody
      };
    });
    
    return JSON.stringify({ success: true, emails: summarizedEmails }, null, 2);
  }
  
  // Handle skill results (product group, etc)
  if (parsed && (parsed.posts || parsed.filteredCount !== undefined || parsed.matchingPosts !== undefined)) {
    const summarized = {
      success: parsed.success,
      filteredCount: parsed.filteredCount,
      matchingPosts: parsed.matchingPosts,
      totalPosts: parsed.totalPosts,
      totalFound: parsed.totalFound,
      month: parsed.month,
      dateWindow: parsed.dateWindow,
      html: parsed.html, // Keep HTML for preview
      // Truncate posts array - handle both url and link fields
      posts: parsed.posts?.slice(0, 10)?.map(p => ({
        title: p.title,
        url: p.url || p.link,
        link: p.link || p.url,
        date: p.date || p.publishedAt,
        publishedAt: p.publishedAt || p.date
      })),
      message: parsed.message,
      error: parsed.error
    };
    
    // Remove undefined fields
    Object.keys(summarized).forEach(k => summarized[k] === undefined && delete summarized[k]);
    
    return JSON.stringify(summarized, null, 2);
  }
  
  // Handle Playwright/MCP results - keep the content but truncate if too large
  if (parsed && parsed.content && Array.isArray(parsed.content)) {
    const content = parsed.content.map(c => {
      if (c.type === 'text' && c.text && c.text.length > 40000) {
        return { ...c, text: c.text.substring(0, 40000) + '\n[... truncated ...]' };
      }
      return c;
    });
    return JSON.stringify({ ...parsed, content }, null, 2);
  }
  
  // Default: just truncate the string if too large
  if (str.length > 50000) {
    return str.substring(0, 50000) + '\n[... truncated ...]';
  }
  
  return str;
}

// Timeout wrapper for async operations
function withTimeout(promise, ms, errorMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage || `Operation timed out after ${ms}ms`)), ms)
    )
  ]);
}

// Execute a function call with timeout
async function executeFunction(name, args) {
  try {
    const skillDefs = getSkillDefinitions();
    if (skillDefs.some(s => s.name === name)) {
      return await executeSkill(name, args);
    }
    
    const toolDefs = getToolDefinitions();
    if (toolDefs.some(t => t.name === name)) {
      // Add 120 second timeout for playwright operations
      if (name.startsWith('playwright_')) {
        try {
          return await withTimeout(
            executeTool(name, args),
            120000,
            `Playwright operation timed out after 120 seconds for ${args.url || 'unknown URL'}`
          );
        } catch (err) {
          console.error(`[API] Tool timeout: ${err.message}`);
          return { 
            success: false, 
            error: err.message,
            timedOut: true 
          };
        }
      }
      return await executeTool(name, args);
    }
    
    return { error: `Unknown function: ${name}` };
  } catch (err) {
    return { error: err.message };
  }
}

// Newsletter template with section placeholders
const NEWSLETTER_TEMPLATE = {
  toc: `<p><strong>In this issue:</strong></p>
<ul>
  <li><a href="#aceaviator">Ace Aviator of the Month</a></li>
  <li><a href="#productnews">News from our product group</a></li>
  <li><a href="#communitynews">News from our community</a></li>
</ul>
<hr>`,
  aceAviator: '<h1 id="aceaviator">Ace Aviator of the Month</h1>\n<p><em>&lt;TODO: Generate Ace Aviator section&gt;</em></p>\n<hr>',
  productGroup: '<h1 id="productnews">News from our product group</h1>\n<p><em>&lt;TODO: Generate Product Group section&gt;</em></p>\n<hr>',
  community: '<h1 id="communitynews">News from our community</h1>\n<p><em>&lt;TODO: Generate Community section&gt;</em></p>'
};

// Detect which section the HTML belongs to
// Only match actual HTML sections, not conversational text
// Returns null if HTML contains multiple DIFFERENT sections (to prevent duplication)
function detectSection(html) {
  const lower = html.toLowerCase();
  
  // Must contain HTML tags to be considered a section
  if (!html.includes('<')) {
    return null;
  }
  
  // Detect which sections are present (by unique section, not by pattern)
  const hasAceAviator = /id="aceaviator"/i.test(html) || /<h1[^>]*>.*ace\s*aviator/i.test(html);
  const hasProductGroup = /id="productnews"/i.test(html) || /<h1[^>]*>.*product\s*(group|news)|<h1[^>]*>.*news from our product/i.test(html);
  const hasCommunity = /id="communitynews"/i.test(html) || /<h1[^>]*>.*community|<h1[^>]*>.*news from our community/i.test(html);
  
  const sectionCount = [hasAceAviator, hasProductGroup, hasCommunity].filter(Boolean).length;
  
  // If multiple DIFFERENT sections detected, don't use this HTML (it would cause duplication)
  if (sectionCount > 1) {
    console.log(`[API] Rejected multi-section HTML (${sectionCount} different sections detected)`);
    return null;
  }
  
  // Return the detected section
  if (hasAceAviator) return 'aceAviator';
  if (hasProductGroup) return 'productGroup';
  if (hasCommunity) return 'community';
  
  return null;
}

// Build full newsletter HTML from sections
function buildNewsletter(sections) {
  return [
    sections.toc,
    sections.aceAviator,
    sections.productGroup,
    sections.community
  ].join('\n');
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId = 'default' } = req.body;
    
    // Get or create session with section-based structure
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { 
        messages: [], 
        sections: { ...NEWSLETTER_TEMPLATE },
        loadedSkills: [] 
      });
    }
    const session = sessions.get(sessionId);
    
    // Detect which skills are needed for this message
    const requiredSkills = detectRequiredSkills(message);
    
    // Track loaded skills per session (accumulate across turns)
    const newSkills = requiredSkills.filter(s => !session.loadedSkills.includes(s));
    if (newSkills.length > 0) {
      console.log(`[API] Loading new skill prompts: ${newSkills.join(', ')}`);
      session.loadedSkills = [...session.loadedSkills, ...newSkills];
    }
    
    // Build dynamic system prompt with only needed skills
    const dynamicPrompt = buildDynamicPrompt(BASE_SYSTEM_PROMPT, session.loadedSkills);
    console.log(`[API] System prompt: ${dynamicPrompt.length} chars (skills: ${session.loadedSkills.join(', ') || 'none'})`);
    
    // Add user message
    session.messages.push({ role: 'user', content: message });
    
    // Truncate messages to stay within limits
    const contextMessages = truncateMessages(session.messages);
    
    // Call Azure OpenAI
    let response = await client.chat.completions.create({
      model: AZURE_MODEL,
      max_completion_tokens: 8192,
      messages: [
        { role: 'system', content: dynamicPrompt },
        ...contextMessages
      ],
      tools: getFunctionDefinitions(),
      tool_choice: 'auto'
    });
    
    let assistantMessage = response.choices[0].message;
    console.log(`[API] Initial response - content: ${assistantMessage.content?.length || 0}, tool_calls: ${assistantMessage.tool_calls?.length || 0}, finish: ${response.choices[0].finish_reason}`);
    
    // Handle tool calls
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      session.messages.push(assistantMessage);
      
      for (const toolCall of assistantMessage.tool_calls) {
        console.log(`[API] Calling ${toolCall.function.name} with args:`, JSON.stringify(toolCall.function.arguments).substring(0, 200));
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeFunction(toolCall.function.name, args);
        
        console.log(`[API] ${toolCall.function.name} result success:`, result?.success, 'has emails:', !!result?.emails, 'has html:', !!result?.html);
        
        // Summarize large results to save tokens
        const summarizedResult = summarizeToolResult(result);
        console.log(`[API] Summarized result length: ${summarizedResult?.length || 0} chars`);
        
        session.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: summarizedResult
        });
        
        // Extract HTML from skill results and update appropriate section
        if (result.html) {
          const section = detectSection(result.html);
          if (section) {
            console.log(`[API] Skill returned HTML for section: ${section}`);
            session.sections[section] = result.html + (section !== 'community' ? '\n<hr>' : '');
          }
        }
      }
      
      // Truncate before next API call
      const contextMessages = truncateMessages(session.messages);
      
      response = await client.chat.completions.create({
        model: AZURE_MODEL,
        max_completion_tokens: 8192,
        messages: [
          { role: 'system', content: dynamicPrompt },
          ...contextMessages
        ],
        tools: getFunctionDefinitions(),
        tool_choice: 'auto'
      });
      
      assistantMessage = response.choices[0].message;
      console.log(`[API] After tool call - content: ${assistantMessage.content?.length || 0} chars, tool_calls: ${assistantMessage.tool_calls?.length || 0}, finish_reason: ${response.choices[0].finish_reason}`);
    }
    
    // Save assistant response
    if (assistantMessage.content) {
      session.messages.push({ role: 'assistant', content: assistantMessage.content });
    }
    
    // Extract HTML from response if present (support various formats)
    let extractedHtml = null;
    const content = assistantMessage.content || '';
    
    console.log(`[API] Final response content length: ${content.length}`);
    
    // If no content but we have tool results with HTML, that's fine - sections were already updated
    if (content.length === 0) {
      console.log(`[API] Empty content response - sections may have been updated via tool results`);
    }
    
    // Try to match ```html blocks (be flexible with whitespace)
    const htmlMatch = content.match(/```html\s*([\s\S]*?)```/);
    if (htmlMatch) {
      extractedHtml = htmlMatch[1].trim();
      console.log(`[API] Extracted HTML length: ${extractedHtml.length}`);
      console.log(`[API] HTML preview: ${extractedHtml.substring(0, 200)}`);
      
      // Detect which section this HTML belongs to and update it
      const section = detectSection(extractedHtml);
      console.log(`[API] Detected section: ${section}`);
      
      if (section) {
        console.log(`[API] Updating section: ${section}`);
        session.sections[section] = extractedHtml + (section !== 'community' ? '\n<hr>' : '');
      } else {
        console.log(`[API] WARNING: Could not detect section for HTML`);
      }
    } else {
      console.log(`[API] No HTML block found in response`);
    }
    
    // Always return the full newsletter with all sections
    const fullNewsletter = buildNewsletter(session.sections);
    console.log(`[API] Full newsletter length: ${fullNewsletter.length}`);
    
    res.json({
      message: assistantMessage.content,
      html: fullNewsletter
    });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Streaming chat endpoint with SSE for real-time section updates
app.post('/api/chat/stream', async (req, res) => {
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };
  
  try {
    const { message, sessionId = 'default' } = req.body;
    
    // Get or create session
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { 
        messages: [], 
        sections: { ...NEWSLETTER_TEMPLATE },
        loadedSkills: [] 
      });
    }
    const session = sessions.get(sessionId);
    
    // Detect required skills
    const requiredSkills = detectRequiredSkills(message);
    const newSkills = requiredSkills.filter(s => !session.loadedSkills.includes(s));
    if (newSkills.length > 0) {
      session.loadedSkills = [...session.loadedSkills, ...newSkills];
    }
    
    const dynamicPrompt = buildDynamicPrompt(BASE_SYSTEM_PROMPT, session.loadedSkills);
    
    // Add user message
    session.messages.push({ role: 'user', content: message });
    const contextMessages = truncateMessages(session.messages);
    
    sendEvent('status', { message: 'Processing request...' });
    
    let response = await client.chat.completions.create({
      model: AZURE_MODEL,
      max_completion_tokens: 8192,
      messages: [
        { role: 'system', content: dynamicPrompt },
        ...contextMessages
      ],
      tools: getFunctionDefinitions(),
      tool_choice: 'auto'
    });
    
    let assistantMessage = response.choices[0].message;
    console.log(`[API-Stream] Initial response - content: ${assistantMessage.content?.length || 0}, tool_calls: ${assistantMessage.tool_calls?.length || 0}`);
    
    // Handle tool calls with streaming updates
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      session.messages.push(assistantMessage);
      
      // Process tool calls sequentially (even if model sends multiple)
      // This prevents parallel execution issues
      const toolCalls = assistantMessage.tool_calls;
      if (toolCalls.length > 1) {
        console.log(`[API-Stream] Model requested ${toolCalls.length} parallel tool calls - processing sequentially`);
      }
      
      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        console.log(`[API-Stream] Calling ${toolName}`);
        sendEvent('tool_start', { tool: toolName });
        
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeFunction(toolName, args);
        
        console.log(`[API-Stream] ${toolName} result - success: ${result?.success}, emails: ${!!result?.emails}, html: ${!!result?.html}`);
        
        const summarizedResult = summarizeToolResult(result);
        console.log(`[API-Stream] Summarized result: ${summarizedResult?.length || 0} chars`);
        
        session.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: summarizedResult
        });
        
        // If a section was completed, send update immediately
        if (result.html) {
          console.log(`[API-Stream] Skill returned HTML: ${result.html.length} chars`);
          const section = detectSection(result.html);
          console.log(`[API-Stream] Detected section: ${section}`);
          if (section) {
            session.sections[section] = result.html + (section !== 'community' ? '\n<hr>' : '');
            console.log(`[API-Stream] Updated section ${section}: ${session.sections[section].length} chars`);
            sendEvent('section_complete', { 
              section, 
              html: buildNewsletter(session.sections),
              message: `✓ ${section === 'aceAviator' ? 'Ace Aviator' : section === 'productGroup' ? 'Product Group' : 'Community News'} section completed`
            });
          }
        }
        
        sendEvent('tool_end', { tool: toolName, success: result.success !== false });
      }
      
      const contextMessages = truncateMessages(session.messages);
      
      response = await client.chat.completions.create({
        model: AZURE_MODEL,
        max_completion_tokens: 8192,
        messages: [
          { role: 'system', content: dynamicPrompt },
          ...contextMessages
        ],
        tools: getFunctionDefinitions(),
        tool_choice: 'auto'
      });
      
      assistantMessage = response.choices[0].message;
    }
    
    // Save final response
    if (assistantMessage.content) {
      session.messages.push({ role: 'assistant', content: assistantMessage.content });
      
      // Check for HTML in response
      const htmlMatch = assistantMessage.content.match(/```html\s*([\s\S]*?)```/);
      if (htmlMatch) {
        const extractedHtml = htmlMatch[1].trim();
        const section = detectSection(extractedHtml);
        if (section) {
          session.sections[section] = extractedHtml + (section !== 'community' ? '\n<hr>' : '');
          sendEvent('section_complete', { 
            section, 
            html: buildNewsletter(session.sections)
          });
        }
      }
    }
    
    // Send final response
    sendEvent('complete', {
      message: assistantMessage.content,
      html: buildNewsletter(session.sections)
    });
    
    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (err) {
    console.error('Stream chat error:', err);
    sendEvent('error', { message: err.message });
    res.end();
  }
});

// Get current HTML (full newsletter)
app.get('/api/html/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (session) {
    res.json({ html: buildNewsletter(session.sections) });
  } else {
    res.json({ html: buildNewsletter(NEWSLETTER_TEMPLATE) });
  }
});

// Update a specific section manually
app.post('/api/html/:sessionId', (req, res) => {
  const { html, section } = req.body;
  if (!sessions.has(req.params.sessionId)) {
    sessions.set(req.params.sessionId, { 
      messages: [], 
      sections: { ...NEWSLETTER_TEMPLATE },
      loadedSkills: [] 
    });
  }
  const sess = sessions.get(req.params.sessionId);
  
  if (section && sess.sections[section] !== undefined) {
    sess.sections[section] = html;
  } else {
    // Auto-detect section
    const detectedSection = detectSection(html);
    if (detectedSection) {
      sess.sections[detectedSection] = html;
    }
  }
  
  res.json({ success: true, html: buildNewsletter(sess.sections) });
});

// Get template (initial newsletter structure)
app.get('/api/template', (req, res) => {
  res.json({ html: buildNewsletter(NEWSLETTER_TEMPLATE) });
});

// Check storage status
app.get('/api/storage/status', (req, res) => {
  const status = isStorageValid();
  res.json(status);
});

// Connect MCP servers
app.post('/api/mcp/connect', async (req, res) => {
  try {
    const { type } = req.body;
    if (type === 'playwright') {
      await connectToPlaywrightMCP({ headless: true });
      const tools = await listMCPTools();
      res.json({ success: true, tools: tools.map(t => t.name) });
    } else if (type === 'email') {
      await connectToEmailMCP();
      const tools = await listEmailMCPTools();
      res.json({ success: true, tools: tools.map(t => t.name) });
    } else {
      res.status(400).json({ error: 'Unknown MCP type' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear session
app.delete('/api/session/:sessionId', (req, res) => {
  sessions.delete(req.params.sessionId);
  res.json({ success: true });
});

// Save newsletter to disk
app.post('/api/newsletter/save', (req, res) => {
  try {
    const { sessionId = 'default', html, messages } = req.body;
    const session = sessions.get(sessionId);
    
    const saveData = {
      sessionId,
      savedAt: new Date().toISOString(),
      sections: session?.sections || NEWSLETTER_TEMPLATE,
      html: html || (session ? buildNewsletter(session.sections) : ''),
      messages: messages || session?.messages || [],
      loadedSkills: session?.loadedSkills || []
    };
    
    const savePath = path.join(SAVE_DIR, `${sessionId}.json`);
    fs.writeFileSync(savePath, JSON.stringify(saveData, null, 2));
    
    console.log(`[API] Newsletter saved to ${savePath}`);
    res.json({ success: true, path: savePath });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Load newsletter from disk
app.get('/api/newsletter/load', (req, res) => {
  try {
    const { sessionId = 'default' } = req.query;
    const savePath = path.join(SAVE_DIR, `${sessionId}.json`);
    
    if (!fs.existsSync(savePath)) {
      // Return template if no saved newsletter
      return res.json({ 
        success: true, 
        html: buildNewsletter(NEWSLETTER_TEMPLATE),
        messages: [],
        isNew: true 
      });
    }
    
    const saveData = JSON.parse(fs.readFileSync(savePath, 'utf-8'));
    
    // Restore session state
    sessions.set(sessionId, {
      messages: saveData.messages || [],
      sections: saveData.sections || { ...NEWSLETTER_TEMPLATE },
      loadedSkills: saveData.loadedSkills || []
    });
    
    console.log(`[API] Newsletter loaded from ${savePath}`);
    res.json({
      success: true,
      html: saveData.html || buildNewsletter(saveData.sections),
      messages: saveData.messages || [],
      savedAt: saveData.savedAt,
      isNew: false
    });
  } catch (err) {
    console.error('Load error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Newsletter Agent API running on http://localhost:${PORT}`);
  
  // Auto-connect to EmailCompanion MCP on startup
  try {
    console.log('Connecting to EmailCompanion MCP...');
    await connectToEmailMCP();
    const tools = await listEmailMCPTools();
    console.log(`EmailCompanion MCP connected: ${tools.length} tools available`);
  } catch (err) {
    console.warn(`EmailCompanion MCP not available: ${err.message}`);
  }
  
  // Auto-connect to Playwright MCP on startup (for web scraping)
  try {
    console.log('Connecting to Playwright MCP...');
    const storageCheck = isStorageValid();
    if (storageCheck.valid) {
      await connectToPlaywrightMCP({ headless: true });
      const tools = await listMCPTools();
      console.log(`Playwright MCP connected: ${tools.length} tools available`);
    } else {
      console.warn(`Playwright MCP: ${storageCheck.reason}. Run /login first.`);
    }
  } catch (err) {
    console.warn(`Playwright MCP not available: ${err.message}`);
  }
});
