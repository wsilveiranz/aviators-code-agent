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
import {
  NewsletterWorkflowRuntime,
  type BeginNewsletterInput,
  type NewsletterTargetInput
} from "./workflowRuntime.js";

export const LANGUAGE_MODEL_TOOL_NAMES = {
  beginNewsletterWorkflow: "aviators_beginNewsletterWorkflow",
  createNewsletterTemplate: "aviators_createNewsletterTemplate",
  getNewsletterWorkflow: "aviators_getNewsletterWorkflow",
  reviewNewsletterWorkflow: "aviators_reviewNewsletterWorkflow",
  persistNewsletterDraft: "aviators_persistNewsletterDraft",
  openNewsletterPreview: "aviators_openNewsletterPreview",
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
  workflowId?: string;
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

const targetProperties = {
  month: { type: "string", description: "Newsletter month and year, e.g. November 2026." },
  fileName: { type: "string", description: "Optional safe .html filename." },
  workspaceFolder: { type: "string", description: "Optional exact open workspace folder URI." }
};
const handleProperties = { workflowId: { type: "string", description: "Handle returned by beginNewsletterWorkflow." } };
export const workflowChatTools: readonly vscode.LanguageModelChatTool[] = [
  {
    name: LANGUAGE_MODEL_TOOL_NAMES.beginNewsletterWorkflow,
    description: "Begin a target-bound newsletter workflow, preserving its accumulated pending draft across completed section commands. Selected sections run Ace, Product, then Community. Incomplete work must be completed or discarded first; saving requires explicit user persistence.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      ...targetProperties, sections: { type: "array", minItems: 1, uniqueItems: true,
        items: { type: "string", enum: ["aceAviator", "productGroup", "community"] } }
    }, required: ["month", "sections"] }
  },
  {
    name: LANGUAGE_MODEL_TOOL_NAMES.createNewsletterTemplate,
    description: "Create a missing newsletter template or open an existing document. Never overwrite an existing file.",
    inputSchema: { type: "object", additionalProperties: false, properties: targetProperties, required: ["month"] }
  },
  {
    name: LANGUAGE_MODEL_TOOL_NAMES.getNewsletterWorkflow,
    description: "Inspect current-workflow stagedSections, all accumulated draftSections, trusted Community continuation URLs, proposal, apply and saved status.",
    inputSchema: { type: "object", additionalProperties: false, properties: handleProperties, required: ["workflowId"] }
  },
  {
    name: LANGUAGE_MODEL_TOOL_NAMES.reviewNewsletterWorkflow,
    description: "Open the staged proposal diff for user review. Does not apply or save generated changes.",
    inputSchema: { type: "object", additionalProperties: false, properties: handleProperties, required: ["workflowId"] }
  },
  {
    name: LANGUAGE_MODEL_TOOL_NAMES.persistNewsletterDraft,
    description: "Persist all accumulated draft sections for one newsletter after explicit user request. A workflowId selects its target, including changes from later section commands. Omit it to select a pending target; ambiguous drafts require a picker. Reject unfinished workflows.",
    inputSchema: { type: "object", additionalProperties: false, properties: handleProperties }
  },
  {
    name: LANGUAGE_MODEL_TOOL_NAMES.openNewsletterPreview,
    description: "Open the persisted newsletter preview, using an optional workflow handle or safe workspace selection.",
    inputSchema: { type: "object", additionalProperties: false, properties: handleProperties }
  }
];

const newsletterLanguageModelChatTools: readonly vscode.LanguageModelChatTool[] =
  [
    toChatTool(LANGUAGE_MODEL_TOOL_NAMES.computeDateWindow, dateWindowSkill),
    toChatTool(LANGUAGE_MODEL_TOOL_NAMES.createAceAviator, withWorkflowSchema(aceAviatorSkill)),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.createProductGroupNews,
      withWorkflowSchema(productGroupSkill)
    ),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.createCommunityNews,
      withWorkflowSchema(communityNewsSkill)
    ),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.getEmailFromMCP,
      emailCompanionDefinition
    ),
    toChatTool(
      LANGUAGE_MODEL_TOOL_NAMES.scrapeLinkedIn,
      withWorkflowSchema(scrapeLinkedInDefinition)
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
    ...workflowChatTools,
    ...workspaceLanguageModelChatTools
  ];

export function getAvailableLanguageModelChatTools():
  readonly vscode.LanguageModelChatTool[] {
  const tools = new Map<string, vscode.LanguageModelChatTool>();

  for (const tool of vscode.lm.tools) {
    tools.set(tool.name, {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    });
  }

  for (const tool of newsletterLanguageModelChatTools) {
    if (!tools.has(tool.name)) {
      tools.set(tool.name, tool);
    }
  }

  return [...tools.values()];
}

export function registerNewsletterLanguageModelTools(workflow: NewsletterWorkflowRuntime): vscode.Disposable[] {
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
      }, workflow)
    ),
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.createProductGroupNews,
      new LocalLanguageModelTool<ProductGroupParams>(productGroupSkill, {
        displayName: "Create Product Group News",
        invocationMessage: "Creating the Product Group News section..."
      }, workflow)
    ),
    vscode.lm.registerTool(
      LANGUAGE_MODEL_TOOL_NAMES.createCommunityNews,
      new LocalLanguageModelTool<CommunityNewsParams>(communityNewsSkill, {
        displayName: "Create Community News",
        invocationMessage: "Creating the Community News section..."
      }, workflow)
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
      }, workflow)
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
    ),
    ...registerWorkflowTools(workflow)
  ];
}

class LocalLanguageModelTool<TInput extends ToolInput>
  implements vscode.LanguageModelTool<TInput & { workflowId?: string }>
{
  constructor(
    private readonly definition: ExecutableDefinition<TInput, unknown>,
    private readonly presentation: ToolPresentation<TInput>,
    private readonly workflow?: NewsletterWorkflowRuntime
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<TInput & { workflowId?: string }>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    throwIfCancelled(token);
    const execute = async (input: TInput): Promise<unknown> => {
      const result = await this.definition.execute(input);
      throwIfCancelled(token);
      return result;
    };
    const result = this.workflow
      ? await this.workflow.execute(this.definition.name, options.input, execute, token)
      : await execute(options.input);
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
    private readonly presentation: ToolPresentation<TInput>,
    private readonly workflow?: NewsletterWorkflowRuntime
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
    const execute = async (input: TInput): Promise<unknown> => {
      const result = await registry.executeTool(this.registryToolName, input);
      throwIfCancelled(token);
      return result;
    };
    const result = this.workflow
      ? await this.workflow.execute(this.registryToolName, options.input, execute, token)
      : await execute(options.input);

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
function withWorkflowSchema(
    definition: Pick<ExecutableDefinition<never, unknown>, "description" | "parameters">
  ): Pick<ExecutableDefinition<never, unknown>, "description" | "parameters"> {
    return {
      description: definition.description + " Supply workflowId to stage the full result into the host workflow.",
      parameters: {
        ...definition.parameters,
        properties: { ...definition.parameters.properties, workflowId: {
          type: "string", description: "Optional host workflow handle; omit for deterministic legacy behavior."
        } }
      }
    };
  }

function registerWorkflowTools(workflow: NewsletterWorkflowRuntime): vscode.Disposable[] {
    function register<T extends object>(name: string, execute: (input: T) => Promise<unknown>): vscode.Disposable {
      return vscode.lm.registerTool(name, {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<T>, token: vscode.CancellationToken) {
          throwIfCancelled(token);
          return toToolResult("Newsletter workflow", await execute(options.input));
        },
        prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<T>, token: vscode.CancellationToken) {
          throwIfCancelled(token);
          return { invocationMessage: "Updating newsletter workflow..." };
        }
      });
    }
    return [
      register<BeginNewsletterInput>(LANGUAGE_MODEL_TOOL_NAMES.beginNewsletterWorkflow, input => workflow.begin(input)),
      register<NewsletterTargetInput>(LANGUAGE_MODEL_TOOL_NAMES.createNewsletterTemplate, input => workflow.createTemplate(input)),
      register<{ workflowId: string }>(LANGUAGE_MODEL_TOOL_NAMES.getNewsletterWorkflow, async input => workflow.get(input.workflowId)),
      register<{ workflowId: string }>(LANGUAGE_MODEL_TOOL_NAMES.reviewNewsletterWorkflow, input => workflow.review(input.workflowId)),
      vscode.lm.registerTool<{ workflowId?: string }>(LANGUAGE_MODEL_TOOL_NAMES.persistNewsletterDraft, {
        async invoke(options, token) {
          throwIfCancelled(token);
          return toToolResult("Persist newsletter draft", await workflow.persist(options.input.workflowId, token));
        },
        prepareInvocation(options, token) {
          throwIfCancelled(token);
          return {
            invocationMessage: "Persisting accumulated newsletter draft...",
            confirmationMessages: {
              title: "Persist newsletter draft?",
              message: "Save every accumulated section in the selected newsletter draft to disk. " +
                (options.input.workflowId
                  ? `Target: ${workflow.get(options.input.workflowId).path}.`
                  : "If several newsletters have drafts, select the target in the picker.") +
                " Incomplete workflows and conflicting editor changes will not be overwritten."
            }
          };
        }
      }),
      register<{ workflowId?: string }>(LANGUAGE_MODEL_TOOL_NAMES.openNewsletterPreview, input => workflow.preview(input.workflowId))
    ];
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
