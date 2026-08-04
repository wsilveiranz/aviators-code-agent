import * as vscode from "vscode";

import {
  aceAviatorSkill,
  communityNewsSkill,
  createAgentRegistry,
  dateWindowSkill,
  productGroupSkill
} from "../core/index.js";
import type {
  AceAviatorParams,
  CommunityNewsParams,
  DateWindowParams,
  EmailParams,
  ExecutableDefinition,
  JsonObject,
  McpBridge,
  ProductGroupParams
} from "../core/index.js";
import { LmToolBridge } from "./lmToolBridge.js";
import { workspaceLanguageModelChatTools } from "./workspaceTools.js";

export const LANGUAGE_MODEL_TOOL_NAMES = {
  computeDateWindow: "aviators_computeDateWindow",
  createAceAviator: "aviators_createAceAviator",
  createProductGroupNews: "aviators_createProductGroupNews",
  createCommunityNews: "aviators_createCommunityNews",
  getEmailFromMCP: "getEmailFromMCP",
  scrapeLinkedIn: "aviators_scrapeLinkedIn",
  resolveRedirects: "aviators_resolveRedirects",
  playwrightNavigate: "playwright_navigate",
  getTechCommunityBlogPosts: "aviators_getTechCommunityBlogPosts"
} as const;

interface PlaywrightNavigateInput {
  url: string;
}

interface ScrapeLinkedInInput {
  urls?: string[];
  inputJson?: string;
  batchSize?: number;
  delayMs?: number;
}

interface ResolveRedirectsInput {
  urls?: string[];
  inputJson?: string;
  delayMs?: number;
}

interface TechCommunityBlogInput {
  month: string;
  startDate: string;
  endDate: string;
}

type ToolInput = object;

interface ToolPresentation<TInput extends ToolInput = ToolInput> {
  displayName: string;
  invocationMessage: string;
  confirmation?: (
    input: TInput
  ) => vscode.LanguageModelToolConfirmationMessages;
}

const metadataBridge: McpBridge = {
  async callTool(): Promise<never> {
    throw new Error("The metadata-only MCP bridge cannot invoke tools.");
  }
};

const metadataRegistry = createAgentRegistry(metadataBridge);

const emailCompanionDefinition = getRegistryToolDefinition("getEmailFromMCP");
const scrapeLinkedInDefinition = getRegistryToolDefinition("scrapeLinkedIn");
const resolveRedirectsDefinition = getRegistryToolDefinition("resolveRedirects");
const playwrightNavigateDefinition = getRegistryToolDefinition(
  "playwright_navigate"
);
const techCommunityBlogDefinition = getRegistryToolDefinition(
  "getTechCommunityBlogPosts"
);

export const newsletterLanguageModelChatTools: readonly vscode.LanguageModelChatTool[] =
  [
    toChatTool(LANGUAGE_MODEL_TOOL_NAMES.computeDateWindow, dateWindowSkill),
    toChatTool(LANGUAGE_MODEL_TOOL_NAMES.createAceAviator, aceAviatorSkill),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.createProductGroupNews,
      productGroupSkill
    ),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.createCommunityNews,
      communityNewsSkill
    ),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.getEmailFromMCP,
      emailCompanionDefinition
    ),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.scrapeLinkedIn,
      scrapeLinkedInDefinition
    ),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.resolveRedirects,
      resolveRedirectsDefinition
    ),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.playwrightNavigate,
      playwrightNavigateDefinition
    ),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.getTechCommunityBlogPosts,
      techCommunityBlogDefinition
    ),
    ...workspaceLanguageModelChatTools
  ];

export function registerNewsletterLanguageModelTools(): vscode.Disposable[] {
  return [
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.computeDateWindow,
      new LocalLanguageModelTool<DateWindowParams>(dateWindowSkill, {
        displayName: "Compute Newsletter Date Window",
        invocationMessage: "Computing the newsletter date window..."
      })
    ),
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.createAceAviator,
      new LocalLanguageModelTool<AceAviatorParams>(aceAviatorSkill, {
        displayName: "Create Ace Aviator Section",
        invocationMessage: "Creating the Ace Aviator section..."
      })
    ),
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.createProductGroupNews,
      new LocalLanguageModelTool<ProductGroupParams>(productGroupSkill, {
        displayName: "Create Product Group News",
        invocationMessage: "Creating the Product Group News section..."
      })
    ),
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.createCommunityNews,
      new LocalLanguageModelTool<CommunityNewsParams>(communityNewsSkill, {
        displayName: "Create Community News",
        invocationMessage: "Creating the Community News section..."
      })
    ),
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.getEmailFromMCP,
      new RegistryLanguageModelTool<EmailParams>("getEmailFromMCP", {
        displayName: "Retrieve Newsletter Email",
        invocationMessage: "Retrieving the requested newsletter email...",
        confirmation: (input) => ({
          title: "Retrieve email from EmailCompanion?",
          message: `This will query the configured EmailCompanion MCP server for messages matching subject "${input.subject}".`
        })
      })
    ),
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.scrapeLinkedIn,
      new RegistryLanguageModelTool<ScrapeLinkedInInput>("scrapeLinkedIn", {
        displayName: "Scrape LinkedIn Activity",
        invocationMessage: "Scraping LinkedIn activity pages...",
        confirmation: (input) => {
          const urls = readStringArray(input, "urls");
          return {
            title: "Scrape LinkedIn activity?",
            message: `This will send network requests to ${
              urls.length > 0 ? `${urls.length} LinkedIn URL(s)` : "the supplied LinkedIn URLs"
            } using the configured Playwright MCP server.`
          };
        }
      })
    ),
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.resolveRedirects,
      new RegistryLanguageModelTool<ResolveRedirectsInput>("resolveRedirects", {
        displayName: "Resolve Redirect URLs",
        invocationMessage: "Resolving redirected URLs...",
        confirmation: (input) => {
          const urls = readStringArray(input, "urls");
          return {
            title: "Visit URLs to resolve redirects?",
            message: `This will send network requests to ${
              urls.length > 0 ? `${urls.length} supplied URL(s)` : "the supplied URLs"
            } using the configured Playwright MCP server.`
          };
        }
      })
    ),
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.playwrightNavigate,
      new RegistryLanguageModelTool<PlaywrightNavigateInput>(
        "playwright_navigate",
        {
          displayName: "Navigate External Page",
          invocationMessage: "Navigating to the requested external page...",
          confirmation: (input) => ({
            title: "Visit external page?",
            message: `This will send a network request to ${describeUrl(
              input.url
            )} using the configured Playwright MCP server.`
          })
        }
      )
    ),
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.getTechCommunityBlogPosts,
      new RegistryLanguageModelTool<TechCommunityBlogInput>(
        "getTechCommunityBlogPosts",
        {
          displayName: "Get Tech Community Blog Posts",
          invocationMessage: "Fetching Tech Community blog posts..."
        }
      )
    )
  ];
}

class LocalLanguageModelTool<TInput extends ToolInput>
  implements vscode.LanguageModelTool<TInput>
{
  constructor(
    private readonly definition: ExecutableDefinition<TInput, unknown>,
    private readonly presentation: ToolPresentation<TInput>
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<TInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    throwIfCancelled(token);
    const result = await this.definition.execute(options.input);
    throwIfCancelled(token);
    return toToolResult(this.presentation.displayName, result);
  }

  prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<TInput>,
    token: vscode.CancellationToken
  ): vscode.PreparedToolInvocation {
    throwIfCancelled(token);
    return {
      invocationMessage: this.presentation.invocationMessage
    };
  }
}

class RegistryLanguageModelTool<TInput extends ToolInput>
  implements vscode.LanguageModelTool<TInput>
{
  constructor(
    private readonly registryToolName: string,
    private readonly presentation: ToolPresentation<TInput>
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<TInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    throwIfCancelled(token);

    if (options.toolInvocationToken === undefined) {
      throw new Error(
        `${this.presentation.displayName} must be invoked from an agent-mode chat request so its tool invocation token can be passed to MCP.`
      );
    }

    const bridge = new LmToolBridge(
      options.toolInvocationToken,
      token,
      options.tokenizationOptions
    );
    const registry = createAgentRegistry(bridge);
    const result = await registry.executeTool(
      this.registryToolName,
      options.input
    );

    throwIfCancelled(token);
    return toToolResult(this.presentation.displayName, result);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<TInput>,
    token: vscode.CancellationToken
  ): vscode.PreparedToolInvocation {
    throwIfCancelled(token);
    return {
      invocationMessage: this.presentation.invocationMessage,
      confirmationMessages: this.presentation.confirmation?.(options.input)
    };
  }
}

function getRegistryToolDefinition(
  name: string
): ExecutableDefinition<never, unknown> {
  const definition = metadataRegistry.tools[name];
  if (!definition) {
    throw new Error(`The core agent registry does not contain tool "${name}".`);
  }
  return definition;
}

function toChatTool(
  name: string,
  definition: Pick<ExecutableDefinition<never, unknown>, "description" | "parameters">
): vscode.LanguageModelChatTool {
  return {
    name,
    description: definition.description,
    inputSchema: definition.parameters
  };
}

function toToolResult(
  displayName: string,
  result: unknown
): vscode.LanguageModelToolResult {
  const text =
    typeof result === "string"
      ? result
      : `${displayName} result:\n${stringifyResult(result)}`;

  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(text)
  ]);
}

function stringifyResult(result: unknown): string {
  if (result === undefined) {
    return "Completed without a result.";
  }

  if (
    result === null ||
    typeof result === "number" ||
    typeof result === "boolean" ||
    typeof result === "bigint"
  ) {
    return String(result);
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}

function readStringArray(input: ToolInput, property: string): string[] {
  const value = (input as JsonObject)[property];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function describeUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "the supplied URL";
  }
}
