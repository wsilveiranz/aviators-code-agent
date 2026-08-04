import { aceAviatorSkill } from './aceAviator.js';
import { communityNewsSkill } from './communityNews.js';
import { dateWindowSkill } from './dateWindow.js';
import { createEmailCompanionTool } from './emailTools.js';
import type { McpBridge, McpBridgeFactory } from './mcpBridge.js';
import {
  createPlaywrightTools,
} from './playwrightTools.js';
import { productGroupSkill } from './productGroup.js';
import type {
  FunctionDefinition,
  Skill,
  Tool,
} from './types.js';
import { toFunctionDefinition } from './types.js';

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
} as const;

export const skills = {
  computeDateWindow: dateWindowSkill,
  createAceAviator: aceAviatorSkill,
  createProductGroupNews: productGroupSkill,
  createCommunityNews: communityNewsSkill
} satisfies Record<string, Skill<never, unknown>>;

type RegistryDefinition = Skill<never, unknown> | Tool<never, unknown>;

export type SkillName = keyof typeof skills;

export interface AgentRegistry {
  readonly skills: typeof skills;
  readonly tools: Readonly<Record<string, RegistryDefinition>>;
  executeSkill(skillName: string, params: unknown): Promise<unknown>;
  executeTool(toolName: string, params: unknown): Promise<unknown>;
  getSkillDefinitions(): FunctionDefinition[];
  getToolDefinitions(): FunctionDefinition[];
}

/**
 * Generate the newsletter template
 * @returns {string}
 */
export function getNewsletterTemplate(): string {
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
<!-- Product Group entries -->
<hr>
<h1 id="communitynews">News from our community</h1>
<!-- Community entries -->`;
}

function executeDefinition(
  definitions: Readonly<Record<string, RegistryDefinition>>,
  kind: 'skill' | 'tool',
  name: string,
  params: unknown,
): Promise<unknown> {
  const definition = definitions[name];
  if (!definition) {
    throw new Error(`Unknown ${kind}: ${name}`);
  }

  const execute = definition.execute as (value: unknown) => Promise<unknown>;
  return execute(params);
}

export function createAgentRegistry(bridge: McpBridge): AgentRegistry {
  const {
    scrapeLinkedInTool,
    resolveRedirectsTool,
    mcpPlaywrightTool,
    mcpSnapshotTool,
    mcpClickTool,
    mcpTypeTool,
    techCommunityBlogTool,
  } = createPlaywrightTools(bridge);

  const tools = {
    getEmailFromMCP: createEmailCompanionTool(bridge),
    scrapeLinkedIn: scrapeLinkedInTool,
    resolveRedirects: resolveRedirectsTool,
    playwright_navigate: mcpPlaywrightTool,
    playwright_snapshot: mcpSnapshotTool,
    playwright_click: mcpClickTool,
    playwright_type: mcpTypeTool,
    getTechCommunityBlogPosts: techCommunityBlogTool,
  } satisfies Record<string, Tool<never, unknown>>;

  return {
    skills,
    tools,
    executeSkill: (skillName, params) =>
      executeDefinition(skills, 'skill', skillName, params),
    executeTool: (toolName, params) =>
      executeDefinition(tools, 'tool', toolName, params),
    getSkillDefinitions: () =>
      Object.values(skills).map(toFunctionDefinition),
    getToolDefinitions: () =>
      Object.values(tools).map(toFunctionDefinition),
  };
}

export async function createAgentRegistryFromFactory(
  factory: McpBridgeFactory,
): Promise<AgentRegistry> {
  return createAgentRegistry(await factory());
}
