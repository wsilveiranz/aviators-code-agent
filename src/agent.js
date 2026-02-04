/**
 * Logic Apps Aviators Newsletter Agent
 * Main agent configuration using Copilot SDK patterns
 */

import { dateWindowSkill } from './skills/dateWindow.js';
import { aceAviatorSkill } from './skills/aceAviator.js';
import { productGroupSkill } from './skills/productGroup.js';
import { communityNewsSkill } from './skills/communityNews.js';
import { 
  scrapeLinkedInTool, 
  resolveRedirectsTool,
  mcpPlaywrightTool,
  mcpSnapshotTool,
  mcpClickTool,
  mcpTypeTool,
  techCommunityBlogTool,
  emailCompanionTool
} from './tools/index.js';

// Agent configuration
export const agentConfig = {
  name: 'Logic Apps Aviators Newsletter Editor',
  description: 'Assemble newsletter from Ace Aviator Q&A, Product Group posts, and Community links.',
  version: '1.0.0',
  
  // Operating modes
  modes: {
    discover: 'Read context first; ask only for missing/ambiguous values',
    create: 'Load skill, produce HTML',
    edit: 'Present draft, accept user edits'
  },
  
  // Newsletter structure
  structure: [
    { id: 'toc', name: 'Table of Contents' },
    { id: 'aceaviator', name: 'Ace Aviator of the Month', skill: 'createAceAviator' },
    { id: 'productnews', name: 'News from Product Group', skill: 'createProductGroupNews' },
    { id: 'communitynews', name: 'News from Community', skill: 'createCommunityNews' }
  ],
  
  // Guardrails
  guardrails: [
    'Use only provided context, crawled content, or explicit user input',
    'Never fabricate facts; prefer omission over fabrication',
    'If uncertain, present candidates and ask user to pick'
  ]
};

// All available skills
export const skills = {
  computeDateWindow: dateWindowSkill,
  createAceAviator: aceAviatorSkill,
  createProductGroupNews: productGroupSkill,
  createCommunityNews: communityNewsSkill
};

// All available tools
export const tools = {
  getEmailFromMCP: emailCompanionTool,
  scrapeLinkedIn: scrapeLinkedInTool,
  resolveRedirects: resolveRedirectsTool,
  playwright_navigate: mcpPlaywrightTool,
  playwright_snapshot: mcpSnapshotTool,
  playwright_click: mcpClickTool,
  playwright_type: mcpTypeTool,
  getTechCommunityBlogPosts: techCommunityBlogTool
};

/**
 * Generate the newsletter template
 * @returns {string}
 */
export function getNewsletterTemplate() {
  return `<p><strong>In this issue:</strong></p>
<ul>
  <li><a href="#aceaviator">Ace Aviator of the Month</a></li>
  <li><a href="#productnews">News from our product group</a></li>
  <li><a href="#communitynews">News from our community</a></li>
</ul>
<hr>
<h1 id="aceaviator">Ace Aviator of the Month</h1>
<!-- Ace content -->
<hr>
<h1 id="productnews">News from our product group</h1>
<table><tbody><!-- PR rows --></tbody></table>
<hr>
<h1 id="communitynews">News from our community</h1>
<!-- Community entries -->`;
}

/**
 * Execute a skill by name
 * @param {string} skillName 
 * @param {object} params 
 * @returns {Promise<object>}
 */
export async function executeSkill(skillName, params) {
  const skill = skills[skillName];
  if (!skill) {
    throw new Error(`Unknown skill: ${skillName}`);
  }
  return await skill.execute(params);
}

/**
 * Execute a tool by name
 * @param {string} toolName 
 * @param {object} params 
 * @returns {Promise<object>}
 */
export async function executeTool(toolName, params) {
  const tool = tools[toolName];
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  return await tool.execute(params);
}

/**
 * Get all skill definitions for LLM function calling
 * @returns {Array}
 */
export function getSkillDefinitions() {
  return Object.values(skills).map(skill => ({
    name: skill.name,
    description: skill.description,
    parameters: skill.parameters
  }));
}

/**
 * Get all tool definitions for LLM function calling
 * @returns {Array}
 */
export function getToolDefinitions() {
  return Object.values(tools).map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
}
