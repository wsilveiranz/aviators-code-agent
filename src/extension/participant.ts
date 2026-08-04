import * as vscode from "vscode";

import {
  agentConfig,
  buildDynamicPrompt,
  detectRequiredSkills,
  isNewsletterTemplateRequest
} from "../core/index.js";
import type { SkillPromptKey } from "../core/index.js";
import type { NewsletterSection } from "../core/newsletter.js";
import {
  readCommunityResumeMetadata,
  type CommunityResumeMetadata
} from "./communityGeneration.js";
import { getMaxToolRounds } from "./config.js";
import {
  APPLY_NEWSLETTER_CHANGES_COMMAND,
  DISCARD_NEWSLETTER_CHANGES_COMMAND,
  NewsletterOutputError,
  NewsletterOutputManager,
  REVIEW_NEWSLETTER_CHANGES_COMMAND,
  emitNewsletterLink
} from "./output.js";
import type { NewsletterOutputSession } from "./output.js";
import { newsletterLanguageModelChatTools } from "./toolRegistry.js";
import {
  serializeToolResultContent,
  truncateSerializedToolResult
} from "./toolResult.js";
import { buildReferenceContext } from "./referenceContext.js";
import {
  invokeWorkspaceTool,
  isWorkspaceTool
} from "./workspaceTools.js";

const TOOL_INPUT_RESERVE_TOKENS = 256;
const MIN_TOOL_RESULT_BUDGET = 256;
const TOOL_INVOCATION_TIMEOUT_MS = 120_000;

export const BASE_SYSTEM_PROMPT = `Treat this first user message as standing operating instructions for the ${agentConfig.name}.

${agentConfig.description}

## Newsletter structure
1. Table of Contents
2. Ace Aviator of the Month
3. News from Product Group
4. News from Community

## Sequential processing
- Complete every section the user requests.
- For multiple sections, work strictly in this order: Ace Aviator, Product Group, Community.
- Complete a section and its required tools before starting the next section.
- Never mix data between sections. Tool calls are executed sequentially.

## Absolute anti-fabrication guardrail
- Never fabricate facts, people, titles, dates, links, summaries, quotations, or HTML content.
- Use only explicit user input and actual tool results.
- Product Group content must come from actual blog results.
- Community content must come from actual LinkedIn and linked-page results.
- A failed, empty, incomplete, or timed-out tool result is not evidence. Report the failure and ask for data or a retry.
- Prefer an empty section or a clear "no content found" result over invented content.
- ${agentConfig.guardrails.join(". ")}.

## Workflow rules
- Use the current chat history and explicitly referenced file content as working context.
- Use the read-only workspace tools when the request depends on files that were not explicitly referenced. Inspect before assuming.
- Compute the configured newsletter date window before gathering date-bound Product Group or Community content.
- Treat workflow parameters as defaults unless the user explicitly overrides them. Follow explicit user inclusion/exclusion instructions, including date-window exceptions, unless they conflict with safety, anti-fabrication, or data-integrity rules.
- Follow each injected skill workflow exactly, including required tool calls and batching.
- Do not skip remaining URL batches.
- When a skill returns newsletter HTML, or a structured Community batch with batchHtml, present the generated content in a fenced \`\`\`html code block.
- If required information is missing, ask only for that information instead of guessing.`;

const CONTINUATION_GUARDRAILS = `Critical continuation guardrails:
- Never fabricate or replace missing tool data; failed or empty results must be reported.
- Continue requested sections strictly in Ace Aviator → Product Group → Community order, completing one before the next.
- Finish every requested section and every remaining batch before claiming completion.`;

export const NEWSLETTER_PARTICIPANT_ID = "aviators.newsletter";

interface ModelCommandRoute {
  readonly kind: "model";
  readonly skills: readonly SkillPromptKey[];
  readonly directive: string;
}

interface PreviewCommandRoute {
  readonly kind: "preview";
}

interface TemplateCommandRoute {
  readonly kind: "template";
}

type ChatCommandRoute =
  | ModelCommandRoute
  | PreviewCommandRoute
  | TemplateCommandRoute;

const CHAT_COMMAND_ROUTES: Readonly<Record<string, ChatCommandRoute>> = {
  newsletter: {
    kind: "template"
  },
  ace: {
    kind: "model",
    skills: ["aceAviator"],
    directive:
      "Generate only the Ace Aviator section, following the injected Ace Aviator workflow."
  },
  product: {
    kind: "model",
    skills: ["dateWindow", "productGroup"],
    directive:
      "Generate only the Product Group News section. Compute the newsletter date window first, then follow the injected Product Group workflow."
  },
  community: {
    kind: "model",
    skills: ["dateWindow", "communityNews"],
    directive:
      "Generate only the Community News section. Compute the newsletter date window first, process every source batch, then follow the injected Community workflow."
  },
  preview: {
    kind: "preview"
  }
};

const SECTION_ORDER: readonly NewsletterSection[] = [
  "aceAviator",
  "productGroup",
  "community"
];

interface MessageGroup {
  readonly messages: readonly vscode.LanguageModelChatMessage[];
}

type AssistantToolPart =
  | vscode.LanguageModelTextPart
  | vscode.LanguageModelToolCallPart
  | vscode.LanguageModelDataPart;

interface ToolMessageGroup extends MessageGroup {
  readonly assistantParts: readonly AssistantToolPart[];
  readonly toolResultParts: readonly vscode.LanguageModelToolResultPart[];
}

interface TokenFitResult {
  readonly messages: vscode.LanguageModelChatMessage[];
  readonly inputTokens: number;
  readonly trimmedHistoryGroups: number;
  readonly trimmedToolGroups: number;
  readonly fits: boolean;
  readonly failureReason?: "newest-tool-exchange";
}

interface HandlerStats {
  toolRounds: number;
  toolCalls: number;
  failedToolCalls: number;
  trimmedHistoryGroups: number;
  trimmedToolGroups: number;
  lastInputTokens: number;
  inputTokenBudget: number;
  requestedSkills: readonly SkillPromptKey[];
  generatedSections: NewsletterSection[];
  outputUri?: string;
}

type HandlerStatus =
  | "completed"
  | "stopped"
  | "cancelled"
  | "error"
  | "delegated";

interface ResultMetadataExtra {
  readonly stopReason?: string;
  readonly pendingToolCalls?: number;
  readonly errorCode?: string;
}

export interface NewsletterChatResultMetadata {
  readonly participant: typeof NEWSLETTER_PARTICIPANT_ID;
  readonly status: HandlerStatus;
  readonly command: string | null;
  readonly requestedSkills: readonly SkillPromptKey[];
  readonly generatedSections: readonly NewsletterSection[];
  readonly outputUri: string | null;
  readonly model: {
    readonly id: string;
    readonly vendor: string;
    readonly family: string;
  };
  readonly toolRounds: number;
  readonly toolCalls: number;
  readonly failedToolCalls: number;
  readonly trimmedHistoryGroups: number;
  readonly trimmedToolGroups: number;
  readonly inputTokens: number;
  readonly inputTokenBudget: number;
  readonly communityResume?: CommunityResumeMetadata;
  readonly stopReason?: string;
  readonly pendingToolCalls?: number;
  readonly errorCode?: string;
}

interface CommunityContinuationCandidate {
  readonly metadata: unknown;
}

export function createNewsletterChatRequestHandler(
  outputManager: NewsletterOutputManager = new NewsletterOutputManager()
): vscode.ChatRequestHandler {
  return async (request, context, response, token) => {
    const stats: HandlerStats = {
      toolRounds: 0,
      toolCalls: 0,
      failedToolCalls: 0,
      trimmedHistoryGroups: 0,
      trimmedToolGroups: 0,
      lastInputTokens: 0,
      inputTokenBudget: 0,
      requestedSkills: [],
      generatedSections: []
    };
    let outputSession: NewsletterOutputSession | undefined;
    const resultMetadata = (
      status: HandlerStatus,
      extra: ResultMetadataExtra = {}
    ): vscode.ChatResult =>
      createResultMetadata(
        request,
        stats,
        status,
        extra,
        outputSession?.getCommunityResumeMetadata()
      );
    const commandRoute = request.command
      ? CHAT_COMMAND_ROUTES[request.command]
      : undefined;

    if (request.command && !commandRoute) {
      const message = `The /${request.command} command is not supported by the Aviators participant.`;
      response.markdown(message);
      return {
        errorDetails: { message },
        ...resultMetadata("error", {
          stopReason: "unsupported-command"
        })
      };
    }

    if (commandRoute?.kind === "preview") {
      outputSession = outputManager.createSession(request, context);
      try {
        const uri = await outputSession.openPreview();
        emitNewsletterLink(response, uri, "Opened newsletter");
        stats.outputUri = uri.toString();
        return resultMetadata("completed", {
          stopReason: "preview-opened"
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        response.markdown(message);
        return {
          errorDetails: { message },
          ...resultMetadata("error", {
            stopReason: "preview-error"
          })
        };
      }
    }

    if (
      commandRoute?.kind === "template" ||
      (!request.command && isNewsletterTemplateRequest(request.prompt))
    ) {
      const templateSession = outputManager.createSession(request, context);
      outputSession = templateSession;
      try {
        const template = await templateSession.ensureTemplate();
        stats.outputUri = template.uri.toString();
        response.markdown(
          template.created
            ? "Created the newsletter template. Use `/ace`, `/product`, or `/community` to update individual sections."
            : "Opened the existing newsletter template. Use `/ace`, `/product`, or `/community` to update individual sections."
        );
        emitNewsletterLink(
          response,
          template.uri,
          template.created ? "Created newsletter" : "Using newsletter"
        );
        return resultMetadata("completed", {
          stopReason: "template-ready"
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        response.markdown(message);
        return {
          errorDetails: { message },
          ...resultMetadata("error", {
            stopReason: "template-error"
          })
        };
      }
    }

    try {
      throwIfCancelled(token);

      const model = request.model;
      const modelRoute =
        commandRoute?.kind === "model" ? commandRoute : undefined;
      const continuationCandidate =
        !request.command && isNaturalContinuationPrompt(request.prompt)
          ? findCommunityContinuationCandidate(context.history)
          : undefined;
      let skillKeys = collectSkillKeys(request.prompt, modelRoute);
      if (
        continuationCandidate &&
        !skillKeys.includes("communityNews")
      ) {
        skillKeys = [...skillKeys, "communityNews"];
      }
      const communityEnabled =
        skillKeys.includes("communityNews") ||
        continuationCandidate !== undefined;
      outputSession = outputManager.createSession(request, context, {
        community: {
          enabled: communityEnabled,
          resumeMetadata: continuationCandidate?.metadata
        }
      });
      const communityResume =
        outputSession.isCommunityResume
          ? outputSession.getCommunityResumeMetadata()
          : undefined;
      const currentPrompt = communityResume
        ? buildCommunityResumePrompt(request.prompt, communityResume)
        : continuationCandidate
          ? buildRejectedResumePrompt(request.prompt)
          : buildCurrentPrompt(request, modelRoute);
      stats.requestedSkills = skillKeys;
      const guardrailPrompt = buildDynamicPrompt(
        BASE_SYSTEM_PROMPT,
        skillKeys
      );
      const baseMessage = vscode.LanguageModelChatMessage.User(
        guardrailPrompt
      );
      const referenceContext = await buildReferenceContext(
        request.references,
        token
      );
      const currentMessage =
        vscode.LanguageModelChatMessage.User(
          `${currentPrompt}${referenceContext}`
        );
      const historyGroups = continuationCandidate
        ? []
        : buildHistoryGroups(context.history);
      const toolGroups: ToolMessageGroup[] = [];
      const toolOptions: vscode.LanguageModelChatRequestOptions = {
        justification:
          "Generate the requested Aviators newsletter content using the model selected in chat.",
        tools: [...newsletterLanguageModelChatTools],
        toolMode: vscode.LanguageModelChatToolMode.Auto
      };
      const inputTokenBudget = await calculateInputTokenBudget(
        model,
        token
      );
      stats.inputTokenBudget = inputTokenBudget;
      const maxToolRounds = getMaxToolRounds(getRequestResource(request));

      while (true) {
        throwIfCancelled(token);

        const fitted = await fitMessagesToBudget(
          model,
          baseMessage,
          historyGroups,
          currentMessage,
          toolGroups,
          inputTokenBudget,
          token
        );
        stats.trimmedHistoryGroups = Math.max(
          stats.trimmedHistoryGroups,
          fitted.trimmedHistoryGroups
        );
        stats.trimmedToolGroups = Math.max(
          stats.trimmedToolGroups,
          fitted.trimmedToolGroups
        );
        stats.lastInputTokens = fitted.inputTokens;

        if (!fitted.fits) {
          const message =
            fitted.failureReason === "newest-tool-exchange"
              ? "The newest tool exchange cannot fit in the selected model's input-token limit, even after explicit truncation. It was not dropped. Narrow the request or choose a model with a larger context window."
              : "The required guardrails and current request exceed the selected model's input-token limit. Shorten the request or choose a model with a larger context window.";
          response.markdown(message);
          return {
            errorDetails: { message },
            ...resultMetadata("error", {
              stopReason: "input-token-limit"
            })
          };
        }

        const modelResponse = await model.sendRequest(
          fitted.messages,
          toolOptions,
          token
        );
        const assistantParts: Array<
          | vscode.LanguageModelTextPart
          | vscode.LanguageModelToolCallPart
          | vscode.LanguageModelDataPart
        > = [];
        const toolCalls: vscode.LanguageModelToolCallPart[] = [];

        for await (const part of modelResponse.stream) {
          throwIfCancelled(token);

          if (part instanceof vscode.LanguageModelTextPart) {
            assistantParts.push(part);
            if (part.value) {
              response.markdown(part.value);
            }
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            assistantParts.push(part);
            toolCalls.push(part);
          } else if (part instanceof vscode.LanguageModelDataPart) {
            assistantParts.push(part);
          } else {
            console.warn(
              "[AviatorsChat] Ignoring an unsupported model response part."
            );
          }
        }

        if (toolCalls.length === 0) {
          if (assistantParts.length === 0) {
            response.markdown(
              "The selected model returned no usable response."
            );
          }
          if (outputSession.hasPendingCommunity()) {
            const resumable =
              outputSession.getCommunityResumeMetadata() !== undefined;
            response.markdown(
              resumable
                ? "\n\nCommunity News still has pending batches. Use the suggested continue action to resume this generation."
                : "\n\nCommunity News still has pending batches, but no safe resume cursor is available. Start a new /community request to regenerate the section."
            );
            return resultMetadata("stopped", {
              stopReason: "community-pending"
            });
          }
          return resultMetadata("completed");
        }

        if (stats.toolRounds >= maxToolRounds) {
          const resumeAction =
            outputSession.getCommunityResumeMetadata()
              ? "use the suggested continue action to resume the pending generation"
              : "continue in a new message";
          const message = `\n\nStopped after ${maxToolRounds} tool rounds, the configured safety limit. The model requested additional tools, so the newsletter may be incomplete. Increase \`aviators.maxToolRounds\` or ${resumeAction}.`;
          response.markdown(message);
          return resultMetadata("stopped", {
            stopReason: "max-tool-rounds",
            pendingToolCalls: toolCalls.length
          });
        }

        stats.toolRounds += 1;
        const toolResultParts: vscode.LanguageModelToolResultPart[] = [];

        for (const toolCall of toolCalls) {
          throwIfCancelled(token);
          stats.toolCalls += 1;
          toolResultParts.push(
            await invokeRequestedTool(
              request,
              model,
              toolCall,
              inputTokenBudget,
              stats,
              outputSession,
              response,
              token
            )
          );
        }

        toolGroups.push(
          createToolMessageGroup(assistantParts, toolResultParts)
        );
      }
    } catch (error) {
      if (
        error instanceof vscode.CancellationError ||
        token.isCancellationRequested
      ) {
        return resultMetadata("cancelled", {
          stopReason: "cancelled"
        });
      }

      const languageModelFailure = describeLanguageModelError(error);
      const message = languageModelFailure.userMessage;
      response.markdown(`\n\n${message}`);
      return {
        errorDetails: {
          message
        },
        ...resultMetadata("error", {
          stopReason:
            error instanceof vscode.LanguageModelError
              ? "language-model-error"
              : "request-error",
          errorCode: languageModelFailure.code
        })
      };
    } finally {
      const proposalSession = outputSession;
      const proposalId = proposalSession?.getProposalId();
      if (
        proposalSession &&
        proposalId &&
        !token.isCancellationRequested
      ) {
        response.markdown(
          "\n\nThe newsletter file has not been changed. Review the proposed diff, then apply or discard it."
        );
        response.button({
          command: REVIEW_NEWSLETTER_CHANGES_COMMAND,
          title: "Review changes",
          arguments: [proposalId]
        });
        response.button({
          command: APPLY_NEWSLETTER_CHANGES_COMMAND,
          title: "Apply changes",
          arguments: [proposalId]
        });
        response.button({
          command: DISCARD_NEWSLETTER_CHANGES_COMMAND,
          title: "Discard changes",
          arguments: [proposalId]
        });
        try {
          await proposalSession.reviewProposal();
        } catch (error) {
          console.warn(
            "[AviatorsChat] Could not open the proposal diff automatically.",
            error
          );
        }
      }
    }
  };
}

export class NewsletterChatFollowupProvider
  implements vscode.ChatFollowupProvider
{
  provideFollowups(
    result: vscode.ChatResult,
    _context: vscode.ChatContext,
    token: vscode.CancellationToken
  ): vscode.ChatFollowup[] {
    if (token.isCancellationRequested) {
      return [];
    }

    const metadata = result.metadata;
    if (
      metadata?.participant !== NEWSLETTER_PARTICIPANT_ID ||
      metadata.command === "preview"
    ) {
      return [];
    }

    const generatedSections = getGeneratedSections(
      metadata.generatedSections
    );
    const communityResume = readCommunityResumeMetadata(
      metadata.communityResume
    );
    const nextCommand =
      metadata.status === "completed"
        ? getNextSectionCommand(
            typeof metadata.command === "string"
              ? metadata.command
              : undefined,
            generatedSections
          )
        : undefined;
    const followups: vscode.ChatFollowup[] = [];

    if (
      metadata.status === "completed" &&
      metadata.stopReason === "template-ready"
    ) {
      followups.push(
        {
          prompt: "Generate the Ace Aviator section.",
          label: "Add Ace Aviator",
          participant: NEWSLETTER_PARTICIPANT_ID,
          command: "ace"
        },
        {
          prompt: "Generate the Product Group News section.",
          label: "Add Product Group News",
          participant: NEWSLETTER_PARTICIPANT_ID,
          command: "product"
        },
        {
          prompt: "Generate the Community News section.",
          label: "Add Community News",
          participant: NEWSLETTER_PARTICIPANT_ID,
          command: "community"
        }
      );
    }

    if (
      communityResume &&
      (
        metadata.status === "stopped" ||
        metadata.status === "cancelled" ||
        metadata.status === "error"
      )
    ) {
      followups.push({
        prompt: "Continue the pending Community News generation.",
        label: "Continue pending Community News",
        participant: NEWSLETTER_PARTICIPANT_ID
      });
    } else if (nextCommand === "product") {
      followups.push({
        prompt: "Generate the Product Group News section next.",
        label: "Continue with Product Group News",
        participant: NEWSLETTER_PARTICIPANT_ID,
        command: "product"
      });
    } else if (nextCommand === "community") {
      followups.push({
        prompt: "Generate the Community News section next.",
        label: "Continue with Community News",
        participant: NEWSLETTER_PARTICIPANT_ID,
        command: "community"
      });
    }

    if (
      typeof metadata.outputUri === "string" &&
      metadata.outputUri.length > 0
    ) {
      followups.push({
        prompt: "Open the current newsletter preview.",
        label: "Open newsletter preview",
        participant: NEWSLETTER_PARTICIPANT_ID,
        command: "preview"
      });
    }

    return followups;
  }
}

function collectSkillKeys(
  prompt: string,
  commandRoute?: ModelCommandRoute
): SkillPromptKey[] {
  if (commandRoute) {
    return [...commandRoute.skills];
  }

  return [...new Set<SkillPromptKey>(detectRequiredSkills(prompt))];
}

function buildCurrentPrompt(
  request: vscode.ChatRequest,
  commandRoute?: ModelCommandRoute
): string {
  const directive = commandRoute?.directive;
  const prompt = request.prompt.trim();

  if (directive && prompt) {
    return `${directive}\n\nUser request:\n${prompt}`;
  }

  return directive ?? prompt;
}

function isNaturalContinuationPrompt(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (
    !normalized ||
    /\b(start over|start again|new generation|regenerate|restart from scratch)\b/.test(
      normalized
    )
  ) {
    return false;
  }

  return /\b(continue|resume|keep going|go on|carry on|proceed|finish|next batch|remaining batches|complete the pending)\b/.test(
    normalized
  );
}

function findCommunityContinuationCandidate(
  history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]
): CommunityContinuationCandidate | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (!(turn instanceof vscode.ChatResponseTurn)) {
      continue;
    }

    const metadata = turn.result.metadata;
    if (
      metadata?.participant !== NEWSLETTER_PARTICIPANT_ID ||
      (
        metadata.status !== "stopped" &&
        metadata.status !== "cancelled" &&
        metadata.status !== "error"
      ) ||
      !Object.prototype.hasOwnProperty.call(
        metadata,
        "communityResume"
      )
    ) {
      return undefined;
    }

    return { metadata: metadata.communityResume };
  }

  return undefined;
}

function buildCommunityResumePrompt(
  prompt: string,
  metadata: CommunityResumeMetadata
): string {
  const userPrompt = prompt.trim();
  const cursor = JSON.stringify(metadata.cursor.urls);
  return `Resume the pending Community News generation from its trusted extension checkpoint.

${metadata.cursor.completedBatches} Community batch(es) are already saved. Do not recreate, quote, request, or pass prior newsletter HTML. Start by calling scrapeLinkedIn with exactly these remaining URLs:
${cursor}

Process every remaining batch and pass hasMore accurately to createCommunityNews. The extension will append the first resumed batch to the existing trusted generation instead of replacing it.${
    userPrompt ? `\n\nUser continuation request:\n${userPrompt}` : ""
  }`;
}

function buildRejectedResumePrompt(prompt: string): string {
  const userPrompt = prompt.trim();
  return `The previous Community continuation checkpoint is stale or invalid and must not be appended to existing partial output. Start a fresh Community generation instead. Use only source URLs explicitly available in the current request; if none are available, ask the user to provide them. Do not request or pass prior newsletter HTML.${
    userPrompt ? `\n\nUser request:\n${userPrompt}` : ""
  }`;
}

function getGeneratedSections(value: unknown): NewsletterSection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (section): section is NewsletterSection =>
      typeof section === "string" &&
      SECTION_ORDER.includes(section as NewsletterSection)
  );
}

function getNextSectionCommand(
  command: string | undefined,
  generatedSections: readonly NewsletterSection[]
): "product" | "community" | undefined {
  const generated = new Set(generatedSections);

  if (
    command === "ace" &&
    generated.has("aceAviator")
  ) {
    return "product";
  }

  if (
    command === "product" &&
    generated.has("productGroup")
  ) {
    return "community";
  }

  if (command === "community") {
    return undefined;
  }

  if (
    generated.has("aceAviator") &&
    !generated.has("productGroup")
  ) {
    return "product";
  }

  if (
    generated.has("productGroup") &&
    !generated.has("community")
  ) {
    return "community";
  }

  return undefined;
}

function buildHistoryGroups(
  history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]
): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let pendingUserMessage: vscode.LanguageModelChatMessage | undefined;

  for (const turn of history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      if (pendingUserMessage) {
        groups.push({ messages: [pendingUserMessage] });
      }
      pendingUserMessage = vscode.LanguageModelChatMessage.User(
        buildHistoricalPrompt(turn)
      );
      continue;
    }

    const assistantText = turn.response
      .filter(
        (part): part is vscode.ChatResponseMarkdownPart =>
          part instanceof vscode.ChatResponseMarkdownPart
      )
      .map((part) => part.value.value)
      .join("");

    if (!assistantText) {
      continue;
    }

    if (pendingUserMessage) {
      groups.push({
        messages: [
          pendingUserMessage,
          vscode.LanguageModelChatMessage.Assistant(assistantText)
        ]
      });
      pendingUserMessage = undefined;
    }
  }

  if (pendingUserMessage) {
    groups.push({ messages: [pendingUserMessage] });
  }

  return groups;
}

function buildHistoricalPrompt(turn: vscode.ChatRequestTurn): string {
  const route = turn.command
    ? CHAT_COMMAND_ROUTES[turn.command]
    : undefined;
  const directive = route?.kind === "model" ? route.directive : undefined;
  const prompt = turn.prompt.trim();

  if (directive && prompt) {
    return `${directive}\n\nUser request:\n${prompt}`;
  }

  return directive ?? prompt;
}

async function calculateInputTokenBudget(
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken
): Promise<number> {
  const serializedTools = newsletterLanguageModelChatTools
    .map((tool) =>
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      })
    )
    .join("\n");
  const toolTokens = serializedTools
    ? await model.countTokens(serializedTools, token)
    : 0;

  return Math.max(
    1,
    model.maxInputTokens - toolTokens - TOOL_INPUT_RESERVE_TOKENS
  );
}

async function fitMessagesToBudget(
  model: vscode.LanguageModelChat,
  baseMessage: vscode.LanguageModelChatMessage,
  historyGroups: readonly MessageGroup[],
  currentMessage: vscode.LanguageModelChatMessage,
  toolGroups: readonly ToolMessageGroup[],
  budget: number,
  token: vscode.CancellationToken
): Promise<TokenFitResult> {
  const baseTokens = await countMessageTokens(model, [baseMessage], token);
  const currentTokens = await countMessageTokens(
    model,
    [currentMessage],
    token
  );
  const historyTokenCounts = await Promise.all(
    historyGroups.map((group) =>
      countMessageTokens(model, group.messages, token)
    )
  );
  const toolTokenCounts = await Promise.all(
    toolGroups.map((group) =>
      countMessageTokens(model, group.messages, token)
    )
  );
  let historyStart = 0;
  let toolStart = 0;
  let inputTokens =
    baseTokens +
    currentTokens +
    sum(historyTokenCounts) +
    sum(toolTokenCounts);

  while (inputTokens > budget && historyStart < historyGroups.length) {
    inputTokens -= historyTokenCounts[historyStart];
    historyStart += 1;
  }

  while (
    inputTokens > budget &&
    toolStart < Math.max(0, toolGroups.length - 1)
  ) {
    inputTokens -= toolTokenCounts[toolStart];
    toolStart += 1;
  }

  const retainedHistoryMessages = historyGroups
    .slice(historyStart)
    .flatMap((group) => group.messages);
  const retainedOlderToolGroups =
    toolGroups.length > 0
      ? toolGroups.slice(toolStart, -1)
      : [];
  const newestToolGroup = toolGroups.at(-1);
  let newestMessages = newestToolGroup?.messages ?? [];
  let failureReason: TokenFitResult["failureReason"];

  if (inputTokens > budget && newestToolGroup) {
    const messagesWithoutNewest = [
      baseMessage,
      ...retainedHistoryMessages,
      currentMessage,
      ...retainedOlderToolGroups.flatMap((group) => group.messages)
    ];
    const tokensWithoutNewest = await countMessageTokens(
      model,
      messagesWithoutNewest,
      token
    );
    const compactedNewest = await compactToolMessageGroup(
      model,
      newestToolGroup,
      budget - tokensWithoutNewest,
      token
    );

    if (compactedNewest) {
      newestMessages = compactedNewest.messages;
      inputTokens = tokensWithoutNewest + compactedNewest.tokens;
    } else {
      failureReason = "newest-tool-exchange";
    }
  }

  return {
    messages: [
      baseMessage,
      ...retainedHistoryMessages,
      currentMessage,
      ...retainedOlderToolGroups.flatMap((group) => group.messages),
      ...newestMessages
    ],
    inputTokens,
    trimmedHistoryGroups: historyStart,
    trimmedToolGroups: toolStart,
    fits: inputTokens <= budget && failureReason === undefined,
    failureReason
  };
}

function createToolMessageGroup(
  assistantParts: readonly AssistantToolPart[],
  toolResultParts: readonly vscode.LanguageModelToolResultPart[]
): ToolMessageGroup {
  return {
    assistantParts,
    toolResultParts,
    messages: [
      vscode.LanguageModelChatMessage.Assistant([...assistantParts]),
      vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelTextPart(CONTINUATION_GUARDRAILS),
        ...toolResultParts
      ])
    ]
  };
}

async function compactToolMessageGroup(
  model: vscode.LanguageModelChat,
  group: ToolMessageGroup,
  budget: number,
  token: vscode.CancellationToken
): Promise<
  | {
      readonly messages: readonly vscode.LanguageModelChatMessage[];
      readonly tokens: number;
    }
  | undefined
> {
  if (budget < 1) {
    return undefined;
  }

  const compactAssistantParts = compactAssistantToolParts(
    group.assistantParts
  );
  const serializedResults = group.toolResultParts.map((part) =>
    serializeToolResultContent(part.content)
  );
  const buildCandidate = (retainedCharacters: number) => {
    const perResultCharacters = distributeCharacterBudget(
      serializedResults,
      retainedCharacters
    );
    const resultParts = group.toolResultParts.map(
      (part, index) =>
        new vscode.LanguageModelToolResultPart(part.callId, [
          new vscode.LanguageModelTextPart(
            truncateSerializedToolResult(
              serializedResults[index],
              perResultCharacters[index]
            )
          )
        ])
    );
    return [
      vscode.LanguageModelChatMessage.Assistant(compactAssistantParts),
      vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelTextPart(CONTINUATION_GUARDRAILS),
        ...resultParts
      ])
    ];
  };

  let bestMessages = buildCandidate(0);
  let bestTokens = await countMessageTokens(model, bestMessages, token);
  if (bestTokens > budget) {
    return undefined;
  }

  let low = 1;
  let high = sum(serializedResults.map((result) => result.length));
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidateMessages = buildCandidate(midpoint);
    const candidateTokens = await countMessageTokens(
      model,
      candidateMessages,
      token
    );

    if (candidateTokens <= budget) {
      bestMessages = candidateMessages;
      bestTokens = candidateTokens;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  return { messages: bestMessages, tokens: bestTokens };
}

function compactAssistantToolParts(
  parts: readonly AssistantToolPart[]
): AssistantToolPart[] {
  const toolCalls = parts.filter(
    (part): part is vscode.LanguageModelToolCallPart =>
      part instanceof vscode.LanguageModelToolCallPart
  );
  const omittedContent = parts.length > toolCalls.length;

  return omittedContent
    ? [
        new vscode.LanguageModelTextPart(
          "[Assistant text omitted to preserve the newest tool exchange.]"
        ),
        ...toolCalls
      ]
    : toolCalls;
}

function distributeCharacterBudget(
  values: readonly string[],
  totalBudget: number
): number[] {
  const budgets = values.map(() => 0);
  let remainingBudget = Math.max(0, totalBudget);
  let remainingIndexes = values
    .map((_value, index) => index)
    .filter((index) => values[index].length > 0);

  while (remainingBudget > 0 && remainingIndexes.length > 0) {
    const share = Math.max(
      1,
      Math.floor(remainingBudget / remainingIndexes.length)
    );
    const nextIndexes: number[] = [];

    for (const index of remainingIndexes) {
      const available = values[index].length - budgets[index];
      const allocated = Math.min(available, share, remainingBudget);
      budgets[index] += allocated;
      remainingBudget -= allocated;
      if (budgets[index] < values[index].length) {
        nextIndexes.push(index);
      }
      if (remainingBudget === 0) {
        break;
      }
    }

    remainingIndexes = nextIndexes;
  }

  return budgets;
}

async function countMessageTokens(
  model: vscode.LanguageModelChat,
  messages: readonly vscode.LanguageModelChatMessage[],
  token: vscode.CancellationToken
): Promise<number> {
  let total = 0;
  for (const message of messages) {
    throwIfCancelled(token);
    total += await model.countTokens(message, token);
  }
  return total;
}

async function invokeRequestedTool(
  request: vscode.ChatRequest,
  model: vscode.LanguageModelChat,
  toolCall: vscode.LanguageModelToolCallPart,
  inputTokenBudget: number,
  stats: HandlerStats,
  outputSession: NewsletterOutputSession,
  response: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.LanguageModelToolResultPart> {
  const localToolNames = new Set(
    newsletterLanguageModelChatTools.map((tool) => tool.name)
  );

  if (!localToolNames.has(toolCall.name)) {
    stats.failedToolCalls += 1;
    return failedToolResult(
      toolCall,
      `Tool "${toolCall.name}" is not one of the Aviators participant's local tools.`
    );
  }

  try {
    outputSession.noteToolInvocation(toolCall);
    const toolResultTokenBudget = Math.max(
      1,
      Math.min(
        inputTokenBudget,
        Math.max(
          MIN_TOOL_RESULT_BUDGET,
          Math.floor(inputTokenBudget / 3)
        )
      )
    );
    const result = await invokeToolWithTimeout(
      toolCall.name,
      {
        input: toolCall.input,
        toolInvocationToken: request.toolInvocationToken,
        tokenizationOptions: {
          tokenBudget: toolResultTokenBudget,
          countTokens: (text, countToken) =>
            model.countTokens(text, countToken ?? token)
        }
      },
      token,
      isWorkspaceTool(toolCall.name)
        ? (toolToken) =>
            invokeWorkspaceTool(
              toolCall.name,
              toolCall.input,
              toolToken
            )
        : undefined
    );
    const writeResult = await outputSession.handleToolResult(
      toolCall,
      result,
      token
    );
    if (writeResult) {
      const isFirstStagedChange = stats.outputUri === undefined;
      if (
        writeResult.complete &&
        !stats.generatedSections.includes(writeResult.section)
      ) {
        stats.generatedSections.push(writeResult.section);
      }
      stats.outputUri = writeResult.uri.toString();
      if (isFirstStagedChange) {
        response.markdown(
          `\n\nStaged the ${getSectionDisplayName(writeResult.section)} section for review in `
        );
        response.anchor(
          writeResult.uri,
          writeResult.uri.path.split("/").at(-1)
        );
      }
    }
    return fitToolResultPartToBudget(
      model,
      toolCall.callId,
      result.content,
      toolResultTokenBudget,
      token
    );
  } catch (error) {
    if (
      error instanceof vscode.CancellationError ||
      token.isCancellationRequested
    ) {
      throw error;
    }

    stats.failedToolCalls += 1;
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof NewsletterOutputError) {
      response.markdown(`\n\nTool result was not saved: ${detail}`);
    }
    return failedToolResult(toolCall, detail);
  }
}

async function fitToolResultPartToBudget(
  model: vscode.LanguageModelChat,
  callId: string,
  content: readonly unknown[],
  budget: number,
  token: vscode.CancellationToken
): Promise<vscode.LanguageModelToolResultPart> {
  const original = new vscode.LanguageModelToolResultPart(callId, [
    ...content
  ]);
  const originalTokens = await countMessageTokens(
    model,
    [vscode.LanguageModelChatMessage.User([original])],
    token
  );
  if (originalTokens <= budget) {
    return original;
  }

  const serialized = serializeToolResultContent(content);
  let best = new vscode.LanguageModelToolResultPart(callId, [
    new vscode.LanguageModelTextPart(
      truncateSerializedToolResult(serialized, 0)
    )
  ]);
  let low = 1;
  let high = serialized.length;

  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidate = new vscode.LanguageModelToolResultPart(callId, [
      new vscode.LanguageModelTextPart(
        truncateSerializedToolResult(serialized, midpoint)
      )
    ]);
    const candidateTokens = await countMessageTokens(
      model,
      [vscode.LanguageModelChatMessage.User([candidate])],
      token
    );

    if (candidateTokens <= budget) {
      best = candidate;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  return best;
}

function getSectionDisplayName(
  section: "aceAviator" | "productGroup" | "community"
): string {
  switch (section) {
    case "aceAviator":
      return "Ace Aviator";
    case "productGroup":
      return "Product Group News";
    case "community":
      return "Community News";
  }
}

async function invokeToolWithTimeout(
  name: string,
  options: vscode.LanguageModelToolInvocationOptions<object>,
  token: vscode.CancellationToken,
  invoke?: (
    token: vscode.CancellationToken
  ) => Promise<vscode.LanguageModelToolResult>
): Promise<vscode.LanguageModelToolResult> {
  const toolCancellation = new vscode.CancellationTokenSource();
  const cancellationSubscription = token.onCancellationRequested(() =>
    toolCancellation.cancel()
  );
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      invoke
        ? invoke(toolCancellation.token)
        : vscode.lm.invokeTool(name, options, toolCancellation.token),
      new Promise<vscode.LanguageModelToolResult>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          toolCancellation.cancel();
          reject(
            new Error(
              `Tool "${name}" timed out after ${
                TOOL_INVOCATION_TIMEOUT_MS / 1000
              } seconds.`
            )
          );
        }, TOOL_INVOCATION_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    cancellationSubscription.dispose();
    toolCancellation.dispose();
  }
}

function failedToolResult(
  toolCall: vscode.LanguageModelToolCallPart,
  detail: string
): vscode.LanguageModelToolResultPart {
  return new vscode.LanguageModelToolResultPart(toolCall.callId, [
    new vscode.LanguageModelTextPart(
      `Tool "${toolCall.name}" failed: ${detail}\nDo not fabricate replacement data. Report the failure or ask the user for the missing input.`
    )
  ]);
}

function getRequestResource(
  request: vscode.ChatRequest
): vscode.Uri | undefined {
  for (const reference of request.references) {
    if (reference.value instanceof vscode.Uri) {
      return reference.value;
    }
    if (reference.value instanceof vscode.Location) {
      return reference.value.uri;
    }
  }

  return vscode.window.activeTextEditor?.document.uri;
}

function describeLanguageModelError(error: unknown): {
  code: string;
  userMessage: string;
} {
  if (error instanceof vscode.LanguageModelError) {
    if (error.code === "NoPermissions") {
      return {
        code: error.code,
        userMessage:
          "The selected language model cannot be used because access was not granted. Check GitHub Copilot access and try again."
      };
    }
    if (error.code === "Blocked") {
      return {
        code: error.code,
        userMessage:
          "The selected language model blocked the request or has reached a service limit. Review the request and your Copilot quota, then try again."
      };
    }
    if (error.code === "NotFound") {
      return {
        code: error.code,
        userMessage:
          "The model selected in chat is no longer available. Select another model and try again."
      };
    }

    return {
      code: error.code || "Unknown",
      userMessage: `The selected language model failed: ${error.message || "Unknown language model error."}`
    };
  }

  return {
    code: error instanceof Error ? error.name : "Unknown",
    userMessage: `The Aviators request failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  };
}

function createResultMetadata(
  request: vscode.ChatRequest,
  stats: HandlerStats,
  status: HandlerStatus,
  extra: ResultMetadataExtra = {},
  communityResume?: CommunityResumeMetadata
): vscode.ChatResult {
  const metadata: NewsletterChatResultMetadata = {
    participant: NEWSLETTER_PARTICIPANT_ID,
    status,
    command: request.command ?? null,
    requestedSkills: stats.requestedSkills,
    generatedSections: stats.generatedSections,
    outputUri: stats.outputUri ?? null,
    model: {
      id: request.model.id,
      vendor: request.model.vendor,
      family: request.model.family
    },
    toolRounds: stats.toolRounds,
    toolCalls: stats.toolCalls,
    failedToolCalls: stats.failedToolCalls,
    trimmedHistoryGroups: stats.trimmedHistoryGroups,
    trimmedToolGroups: stats.trimmedToolGroups,
    inputTokens: stats.lastInputTokens,
    inputTokenBudget: stats.inputTokenBudget,
    ...(communityResume ? { communityResume } : {}),
    ...extra
  };

  return {
    metadata
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}
