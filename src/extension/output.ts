import * as vscode from "vscode";
import { randomUUID } from "node:crypto";

import {
  NEWSLETTER_TEMPLATE,
  buildNewsletter,
  detectSection
} from "../core/newsletter.js";
import { extractRequestedNewsletterFileName } from "../core/newsletterRequest.js";
import {
  findCommunityNewsBatchResult
} from "../core/communityNews.js";
import type {
  NewsletterSection,
  NewsletterSections
} from "../core/newsletter.js";
import type { CommunityBatchItem } from "../core/communityNews.js";
import {
  CommunityGenerationCoordinator,
  CommunityGenerationRun,
  type CommunityBatchWrite,
  type CommunityResumeMetadata
} from "./communityGeneration.js";
import { getOutputFolder } from "./config.js";
import { findExplicitToolFailure } from "./toolResult.js";

export const OPEN_NEWSLETTER_COMMAND = "aviators.openPreview";
export const REVIEW_NEWSLETTER_CHANGES_COMMAND =
  "aviators.reviewNewsletterChanges";
export const APPLY_NEWSLETTER_CHANGES_COMMAND =
  "aviators.applyNewsletterChanges";
export const DISCARD_NEWSLETTER_CHANGES_COMMAND =
  "aviators.discardNewsletterChanges";
export const NEWSLETTER_PROPOSAL_SCHEME = "aviators-newsletter-proposal";

const COMMUNITY_NEWS_TOOL_NAME = "aviators_createCommunityNews";
const SCRAPE_LINKEDIN_TOOL_NAME = "aviators_scrapeLinkedIn";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;
const MONTH_ALIASES: ReadonlyArray<readonly string[]> = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sept", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"]
];

export interface NewsletterWriteResult {
  readonly uri: vscode.Uri;
  readonly section: NewsletterSection;
  readonly complete: boolean;
  readonly proposalId: string;
}

export interface NewsletterTemplateResult {
  readonly uri: vscode.Uri;
  readonly created: boolean;
}

export interface NewsletterOutputSessionOptions {
  readonly community?: {
    readonly enabled: boolean;
    readonly resumeMetadata?: unknown;
  };
}

export class NewsletterOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterOutputError";
  }
}

interface NewsletterQuickPickItem extends vscode.QuickPickItem {
  readonly uri: vscode.Uri;
}

interface NewsletterProposal {
  readonly id: string;
  readonly uri: vscode.Uri;
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly originalContent: string | undefined;
  proposedContent: string;
  section: NewsletterSection;
  complete: boolean;
  status: "pending" | "applied" | "discarded";
  onDiscard?: () => void;
}

export class NewsletterOutputManager
  implements vscode.TextDocumentContentProvider
{
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly recentByWorkspace = new Map<string, vscode.Uri>();
  private readonly proposals = new Map<string, NewsletterProposal>();
  private readonly proposalChanges = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.proposalChanges.event;
  private readonly communityGenerations =
    new CommunityGenerationCoordinator();

  createSession(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    options: NewsletterOutputSessionOptions = {}
  ): NewsletterOutputSession {
    const community = options.community;
    const candidateRun =
      community?.enabled && community.resumeMetadata !== undefined
        ? this.communityGenerations.resumeGeneration(
            community.resumeMetadata
          )
        : undefined;
    const candidateTarget = candidateRun
      ? this.communityGenerations.getGenerationTarget(
          candidateRun.generationId
        )
      : undefined;
    const trustedTargets = [
      ...findNewsletterReferences(request.references),
      ...findNewsletterHistoryAnchors(context.history)
    ].map((uri) => uri.toString());
    const resumedRun =
      candidateRun &&
      (
        candidateTarget === undefined ||
        trustedTargets.includes(candidateTarget)
      )
        ? candidateRun
        : undefined;
    const communityGeneration = community?.enabled
      ? resumedRun ?? this.communityGenerations.startGeneration()
      : undefined;
    return new NewsletterOutputSession(
      this,
      request,
      context,
      communityGeneration,
      resumedRun !== undefined
    );
  }

  async writeSection(
    proposalId: string,
    uri: vscode.Uri,
    section: NewsletterSection,
    html: string,
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<NewsletterWriteResult> {
    return this.updateNewsletter(
      proposalId,
      uri,
      section,
      workspaceFolder,
      (sections) => {
        sections[section] = html.trim();
      }
    );
  }

  async ensureTemplate(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<NewsletterTemplateResult> {
    let created = false;
    await this.enqueueWrite(uri, async () => {
      if (await uriExists(uri)) {
        return;
      }
      await vscode.workspace.fs.createDirectory(getUriDirectory(uri));
      await vscode.workspace.fs.writeFile(
        uri,
        textEncoder.encode(buildNewsletter({ ...NEWSLETTER_TEMPLATE }))
      );
      created = true;
    });
    this.recentByWorkspace.set(workspaceFolder.uri.toString(), uri);
    return { uri, created };
  }

  async writeCommunityBatch(
    proposalId: string,
    uri: vscode.Uri,
    items: CommunityBatchItem[],
    hasMore: boolean,
    workspaceFolder: vscode.WorkspaceFolder,
    write: CommunityBatchWrite
  ): Promise<NewsletterWriteResult> {
    const target = uri.toString();
    const result = await this.updateNewsletter(
      proposalId,
      uri,
      "community",
      workspaceFolder,
      (sections) => {
        const prepared = this.communityGenerations.prepareBatch(
          target,
          write,
          items
        );
        sections.community = prepared.html;
        this.communityGenerations.commitBatch(
          target,
          write,
          prepared,
          { hasMore }
        );
      }
    );
    return { ...result, complete: !hasMore };
  }

  private async updateNewsletter(
    proposalId: string,
    uri: vscode.Uri,
    section: NewsletterSection,
    workspaceFolder: vscode.WorkspaceFolder,
    update: (sections: NewsletterSections) => void
  ): Promise<NewsletterWriteResult> {
    try {
      await this.enqueueWrite(uri, async () => {
        const existingProposal = this.proposals.get(proposalId);
        if (
          existingProposal &&
          existingProposal.uri.toString() !== uri.toString()
        ) {
          throw new NewsletterOutputError(
            "A single chat request cannot stage changes for multiple newsletter files."
          );
        }
        if (
          existingProposal?.status !== undefined &&
          existingProposal.status !== "pending"
        ) {
          throw new NewsletterOutputError(
            "This newsletter proposal is no longer pending."
          );
        }

        const snapshot = existingProposal
          ? {
              originalContent: existingProposal.originalContent,
              currentContent: existingProposal.proposedContent
            }
          : await readNewsletterSnapshot(uri);
        const sections = parseNewsletterSections(
          snapshot.currentContent,
          uri
        );
        update(sections);
        const proposedContent = buildNewsletter(sections);
        const proposal: NewsletterProposal =
          existingProposal ?? {
            id: proposalId,
            uri,
            workspaceFolder,
            originalContent: snapshot.originalContent,
            proposedContent,
            section,
            complete: true,
            status: "pending"
          };
        proposal.proposedContent = proposedContent;
        proposal.section = section;
        this.proposals.set(proposalId, proposal);
        this.fireProposalChanged(proposal);
      });
    } catch (error) {
      if (error instanceof NewsletterOutputError) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new NewsletterOutputError(
        `Failed to stage ${uri.toString()}: ${detail}`
      );
    }

    return { uri, section, complete: true, proposalId };
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const proposal = this.proposals.get(uri.authority);
    if (!proposal) {
      return "This newsletter proposal is no longer available.";
    }
    return uri.path.startsWith("/original/")
      ? proposal.originalContent ?? ""
      : proposal.proposedContent;
  }

  async reviewProposal(proposalId: string): Promise<void> {
    const proposal = this.getPendingProposal(proposalId);
    await vscode.commands.executeCommand(
      "vscode.diff",
      this.getProposalUri(proposal, "original"),
      this.getProposalUri(proposal, "proposed"),
      `Review Aviators changes: ${getUriFileName(proposal.uri)}`
    );
  }

  async applyProposal(proposalId: string): Promise<vscode.Uri> {
    const proposal = this.getPendingProposal(proposalId);
    await this.enqueueWrite(proposal.uri, async () => {
      const current = await readOptionalTextFile(proposal.uri);
      if (current !== proposal.originalContent) {
        throw new NewsletterOutputError(
          `The newsletter changed after this proposal was created. Review and regenerate before applying: ${proposal.uri.toString()}`
        );
      }
      await vscode.workspace.fs.createDirectory(
        getUriDirectory(proposal.uri)
      );
      const edit = new vscode.WorkspaceEdit();
      if (proposal.originalContent === undefined) {
        edit.createFile(proposal.uri, { ignoreIfExists: false });
        edit.insert(
          proposal.uri,
          new vscode.Position(0, 0),
          proposal.proposedContent
        );
      } else {
        const document = await vscode.workspace.openTextDocument(
          proposal.uri
        );
        edit.replace(
          proposal.uri,
          new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
          ),
          proposal.proposedContent
        );
      }
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new NewsletterOutputError(
          `VS Code could not apply the newsletter proposal: ${proposal.uri.toString()}`
        );
      }
      proposal.status = "applied";
    });
    this.recentByWorkspace.set(
      proposal.workspaceFolder.uri.toString(),
      proposal.uri
    );
    return proposal.uri;
  }

  discardProposal(proposalId: string): void {
    const proposal = this.getPendingProposal(proposalId);
    proposal.status = "discarded";
    proposal.onDiscard?.();
  }

  setProposalDiscardHandler(
    proposalId: string,
    onDiscard: () => void
  ): void {
    const proposal = this.proposals.get(proposalId);
    if (proposal && !proposal.onDiscard) {
      proposal.onDiscard = onDiscard;
    }
  }

  private getPendingProposal(proposalId: string): NewsletterProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "pending") {
      throw new NewsletterOutputError(
        "This newsletter proposal is no longer pending."
      );
    }
    return proposal;
  }

  private getProposalUri(
    proposal: NewsletterProposal,
    side: "original" | "proposed"
  ): vscode.Uri {
    return vscode.Uri.from({
      scheme: NEWSLETTER_PROPOSAL_SCHEME,
      authority: proposal.id,
      path: `/${side}/${getUriFileName(proposal.uri)}`
    });
  }

  private fireProposalChanged(proposal: NewsletterProposal): void {
    this.proposalChanges.fire(this.getProposalUri(proposal, "original"));
    this.proposalChanges.fire(this.getProposalUri(proposal, "proposed"));
  }

  recordCommunityScrapeStarted(
    generationId: string,
    input: unknown
  ): void {
    this.communityGenerations.recordScrapeStarted(
      generationId,
      input
    );
  }

  recordCommunityScrapeResult(
    generationId: string,
    value: unknown
  ): void {
    this.communityGenerations.recordScrapeResult(
      generationId,
      value
    );
  }

  getCommunityResumeMetadata(
    generationId: string
  ): CommunityResumeMetadata | undefined {
    return this.communityGenerations.getResumeMetadata(generationId);
  }

  hasPendingCommunityGeneration(generationId: string): boolean {
    return this.communityGenerations.hasPendingGeneration(generationId);
  }

  abandonCommunityGeneration(generationId: string): void {
    this.communityGenerations.abandonGeneration(generationId);
  }

  startCommunityGeneration(): CommunityGenerationRun {
    return this.communityGenerations.startGeneration();
  }

  hasPendingProposal(proposalId: string): boolean {
    return this.proposals.get(proposalId)?.status === "pending";
  }

  async openNewsletter(candidate?: unknown): Promise<vscode.Uri> {
    if (candidate instanceof vscode.Uri) {
      await openNewsletterUri(candidate);
      return candidate;
    }

    const activeFolder = vscode.window.activeTextEditor
      ? vscode.workspace.getWorkspaceFolder(
          vscode.window.activeTextEditor.document.uri
        )
      : undefined;
    const activeRecent = activeFolder
      ? this.recentByWorkspace.get(activeFolder.uri.toString())
      : undefined;

    if (activeRecent && (await uriExists(activeRecent))) {
      await openNewsletterUri(activeRecent);
      return activeRecent;
    }

    const availableRecent = (
      await Promise.all(
        [...this.recentByWorkspace.entries()].map(
          async ([workspaceKey, uri]) => ({
            workspaceKey,
            uri,
            exists: await uriExists(uri)
          })
        )
      )
    ).filter((entry) => entry.exists);

    if (availableRecent.length === 1) {
      await openNewsletterUri(availableRecent[0].uri);
      return availableRecent[0].uri;
    }

    if (availableRecent.length > 1) {
      const selected = await vscode.window.showQuickPick(
        availableRecent.map(({ workspaceKey, uri }) => ({
          label: getUriFileName(uri),
          description:
            vscode.workspace.workspaceFolders?.find(
              (folder) => folder.uri.toString() === workspaceKey
            )?.name ?? workspaceKey,
          detail: uri.toString(),
          uri
        })),
        {
          title: "Aviators: Open Newsletter",
          placeHolder: "Select the workspace newsletter to open"
        }
      );

      if (!selected) {
        throw new NewsletterOutputError(
          "Newsletter selection was cancelled."
        );
      }

      await openNewsletterUri(selected.uri);
      return selected.uri;
    }

    return this.selectAndOpenNewsletter();
  }

  async selectAndOpenNewsletter(
    preferredFolder?: vscode.WorkspaceFolder
  ): Promise<vscode.Uri> {
    const folder =
      preferredFolder ?? (await selectWorkspaceFolder([], "open a newsletter"));
    const outputDirectory = getOutputDirectory(folder);
    let entries: [string, vscode.FileType][];

    try {
      entries = await vscode.workspace.fs.readDirectory(outputDirectory);
    } catch (error) {
      if (isFileNotFound(error)) {
        throw new NewsletterOutputError(
          `No newsletter output folder exists in workspace "${folder.name}".`
        );
      }
      throw error;
    }

    const newsletters = entries
      .filter(
        ([name, type]) =>
          (type & vscode.FileType.File) !== 0 &&
          name.toLowerCase().endsWith(".html")
      )
      .map(
        ([name]): NewsletterQuickPickItem => ({
          label: name,
          description: folder.name,
          detail: vscode.Uri.joinPath(outputDirectory, name).toString(),
          uri: vscode.Uri.joinPath(outputDirectory, name)
        })
      )
      .sort((left, right) => left.label.localeCompare(right.label));

    if (newsletters.length === 0) {
      throw new NewsletterOutputError(
        `No newsletter HTML files were found in workspace "${folder.name}".`
      );
    }

    const selected =
      newsletters.length === 1
        ? newsletters[0]
        : await vscode.window.showQuickPick(newsletters, {
            title: "Aviators: Open Newsletter",
            placeHolder: "Select a newsletter file to open"
          });

    if (!selected) {
      throw new NewsletterOutputError("Newsletter selection was cancelled.");
    }

    await openNewsletterUri(selected.uri);
    return selected.uri;
  }

  getOutputUri(
    folder: vscode.WorkspaceFolder,
    monthYear?: string,
    requestedFileName?: string
  ): vscode.Uri {
    return vscode.Uri.joinPath(
      getOutputDirectory(folder),
      requestedFileName ?? deriveNewsletterFileName(monthYear)
    );
  }

  isOutputUri(
    folder: vscode.WorkspaceFolder,
    uri: vscode.Uri
  ): boolean {
    const outputDirectory = getOutputDirectory(folder);
    const fileName = getUriFileName(uri);
    return (
      sameUriLocation(getUriDirectory(uri), outputDirectory) &&
      isSafeNewsletterFileName(fileName)
    );
  }

  private async enqueueWrite<T>(
    uri: vscode.Uri,
    operation: () => Promise<T>
  ): Promise<T> {
    const key = uri.toString();
    const prior = this.writeQueues.get(key) ?? Promise.resolve();
    const result = prior.catch(() => undefined).then(operation);
    const completion = result.then(
      () => undefined,
      () => undefined
    );
    this.writeQueues.set(key, completion);

    try {
      return await result;
    } finally {
      if (this.writeQueues.get(key) === completion) {
        this.writeQueues.delete(key);
      }
    }
  }
}

export class NewsletterOutputSession {
  private readonly proposalId = randomUUID();
  private readonly targetCandidates: readonly vscode.Uri[];
  private monthYear: string | undefined;
  private readonly requestedFileName: string | undefined;
  private targetUri: vscode.Uri | undefined;
  private workspaceFolder: vscode.WorkspaceFolder | undefined;
  private initialTargetResolved = false;
  private targetLocked = false;

  constructor(
    private readonly manager: NewsletterOutputManager,
    private readonly request: vscode.ChatRequest,
    private readonly context: vscode.ChatContext,
    private communityGeneration: CommunityGenerationRun | undefined,
    readonly isCommunityResume: boolean
  ) {
    this.monthYear = normalizeMonthYear(request.prompt);
    this.requestedFileName = extractRequestedNewsletterFileName(
      request.prompt
    );
    this.targetCandidates = this.monthYear || this.requestedFileName
      ? []
      : [
          ...findNewsletterReferences(request.references),
          ...findNewsletterHistoryAnchors(context.history)
        ];
  }

  noteToolInvocation(
    toolCall: vscode.LanguageModelToolCallPart
  ): void {
    if (toolCall.name !== SCRAPE_LINKEDIN_TOOL_NAME) {
      return;
    }

    const generation = this.getOrStartCommunityGeneration();
    this.manager.recordCommunityScrapeStarted(
      generation.generationId,
      toolCall.input
    );
  }

  getCommunityResumeMetadata():
    | CommunityResumeMetadata
    | undefined {
    return this.communityGeneration
      ? this.manager.getCommunityResumeMetadata(
          this.communityGeneration.generationId
        )
      : undefined;
  }

  hasPendingCommunity(): boolean {
    return this.communityGeneration
      ? this.manager.hasPendingCommunityGeneration(
          this.communityGeneration.generationId
        )
      : false;
  }

  async ensureTemplate(): Promise<NewsletterTemplateResult> {
    const target = await this.resolveTarget(true);
    if (!target) {
      throw new NewsletterOutputError(
        "Unable to determine a newsletter output file."
      );
    }
    this.targetLocked = true;
    return this.manager.ensureTemplate(target.uri, target.folder);
  }

  async handleToolResult(
    toolCall: vscode.LanguageModelToolCallPart,
    result: Pick<vscode.LanguageModelToolResult, "content">,
    token: vscode.CancellationToken
  ): Promise<NewsletterWriteResult | undefined> {
    const failure = findExplicitToolFailure(result.content);
    if (failure) {
      throw new NewsletterOutputError(
        `Tool "${toolCall.name}" reported failure: ${failure}. Existing newsletter output was not changed.`
      );
    }

    const toolMonth = getToolCallMonth(toolCall.input);
    if (toolMonth) {
      this.setMonthYear(toolMonth);
    }

    if (toolCall.name === SCRAPE_LINKEDIN_TOOL_NAME) {
      const generation = this.getOrStartCommunityGeneration();
      this.manager.recordCommunityScrapeResult(
        generation.generationId,
        result.content
      );
      return undefined;
    }

    if (toolCall.name === COMMUNITY_NEWS_TOOL_NAME) {
      const batch = findCommunityNewsBatchResult(result.content);
      if (!batch) {
        throw new NewsletterOutputError(
          "Community News tool returned an invalid batch result. Existing newsletter output was not changed."
        );
      }

      throwIfCancelled(token);
      const target = await this.resolveTarget(true);
      if (!target) {
        throw new NewsletterOutputError(
          "Unable to determine a newsletter output file."
        );
      }

      const targetKey = target.uri.toString();
      const generation = this.getOrStartCommunityGeneration();
      const write = generation.prepareBatch(targetKey);
      const writeResult = await this.manager.writeCommunityBatch(
        this.proposalId,
        target.uri,
        batch.items,
        batch.hasMore,
        target.folder,
        write
      );
      generation.markBatchPersisted(targetKey, write);
      this.manager.setProposalDiscardHandler(this.proposalId, () =>
        this.manager.abandonCommunityGeneration(generation.generationId)
      );
      return writeResult;
    }

    const html = extractHtmlFromToolResult(result);
    if (html === undefined) {
      return undefined;
    }

    const section = detectSection(html);
    if (!section) {
      throw new NewsletterOutputError(
        `Tool "${toolCall.name}" returned HTML that does not identify exactly one newsletter section.`
      );
    }

    throwIfCancelled(token);
    const target = await this.resolveTarget(true);
    if (!target) {
      throw new NewsletterOutputError(
        "Unable to determine a newsletter output file."
      );
    }

    return this.manager.writeSection(
      this.proposalId,
      target.uri,
      section,
      html,
      target.folder
    );
  }

  async reviewProposal(): Promise<void> {
    await this.manager.reviewProposal(this.proposalId);
  }

  getProposalId(): string | undefined {
    return this.manager.hasPendingProposal(this.proposalId)
      ? this.proposalId
      : undefined;
  }

  async openPreview(): Promise<vscode.Uri> {
    const target = await this.resolveTarget(false);
    if (target) {
      if (!(await uriExists(target.uri))) {
        throw new NewsletterOutputError(
          `Newsletter file does not exist yet: ${target.uri.toString()}`
        );
      }
      await openNewsletterUri(target.uri);
      return target.uri;
    }

    return this.manager.openNewsletter();
  }

  private getOrStartCommunityGeneration(): CommunityGenerationRun {
    this.communityGeneration ??=
      this.manager.startCommunityGeneration();
    return this.communityGeneration;
  }

  private setMonthYear(value: string): void {
    const normalized = normalizeMonthYear(value);
    if (!normalized || normalized === this.monthYear) {
      return;
    }

    this.monthYear = normalized;
    if (this.targetLocked) {
      return;
    }
    this.targetUri = undefined;
    this.initialTargetResolved = true;
  }

  private async resolveTarget(
    allowFallback: boolean
  ): Promise<
    { uri: vscode.Uri; folder: vscode.WorkspaceFolder } | undefined
  > {
    if (!this.initialTargetResolved) {
      await this.resolveInitialTarget();
    }

    if (this.targetUri) {
      const folder =
        this.workspaceFolder ??
        vscode.workspace.getWorkspaceFolder(this.targetUri);
      if (folder) {
        this.workspaceFolder = folder;
        return { uri: this.targetUri, folder };
      }
      this.targetUri = undefined;
    }

    if (!this.monthYear) {
      this.monthYear = findHistoricalMonth(this.context.history);
    }

    if (!this.monthYear && !allowFallback) {
      return undefined;
    }

    const folder = await this.resolvePreferredWorkspaceFolder();
    const uri = this.manager.getOutputUri(
      folder,
      this.monthYear,
      this.requestedFileName
    );
    this.targetUri = uri;
    this.workspaceFolder = folder;
    this.targetLocked = this.requestedFileName !== undefined;
    return { uri, folder };
  }

  private async resolveInitialTarget(): Promise<void> {
    this.initialTargetResolved = true;

    for (const candidate of this.targetCandidates) {
      const folder = vscode.workspace.getWorkspaceFolder(candidate);
      if (folder && this.manager.isOutputUri(folder, candidate)) {
        this.targetUri = candidate;
        this.workspaceFolder = folder;
        this.targetLocked = true;
        this.monthYear =
          normalizeMonthYear(getUriFileName(candidate)) ?? this.monthYear;
        return;
      }
    }
  }

  private async resolvePreferredWorkspaceFolder(
    action = "save the newsletter"
  ): Promise<vscode.WorkspaceFolder> {
    if (this.workspaceFolder) {
      return this.workspaceFolder;
    }

    const preferredUris = getReferenceUris(this.request.references);
    const folder = await selectWorkspaceFolder(
      preferredUris,
      action
    );
    this.workspaceFolder = folder;
    return folder;
  }
}

export function emitNewsletterLink(
  response: vscode.ChatResponseStream,
  uri: vscode.Uri,
  message: string
): void {
  response.markdown(`\n\n${message} `);
  response.anchor(uri, getUriFileName(uri));
  response.button({
    command: OPEN_NEWSLETTER_COMMAND,
    title: "Open newsletter",
    arguments: [uri]
  });
}

export function deriveNewsletterFileName(
  requestedMonthYear?: string,
  now: Date = new Date()
): string {
  const normalized =
    (requestedMonthYear
      ? normalizeMonthYear(requestedMonthYear)
      : undefined) ??
    `${MONTH_NAMES[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
  const [month, year] = normalized.split(" ");
  return `${month}-${year}.html`;
}

function isSafeNewsletterFileName(fileName: string): boolean {
  return (
    fileName.length > 5 &&
    fileName.length <= 128 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.html$/i.test(fileName)
  );
}

export function normalizeMonthYear(value: string): string | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }

  for (let index = 0; index < MONTH_ALIASES.length; index += 1) {
    const aliasPattern = MONTH_ALIASES[index].join("|");
    const match = text.match(
      new RegExp(
        `\\b(?:${aliasPattern})\\.?[\\s,/_-]+((?:19|20)\\d{2})\\b`,
        "i"
      )
    );
    if (match) {
      return `${MONTH_NAMES[index]} ${match[1]}`;
    }
  }

  const yearFirst = text.match(
    /\b((?:19|20)\d{2})[\s/_-]+(0?[1-9]|1[0-2])\b/
  );
  if (yearFirst) {
    return `${MONTH_NAMES[Number(yearFirst[2]) - 1]} ${yearFirst[1]}`;
  }

  const monthFirst = text.match(
    /\b(0?[1-9]|1[0-2])[\s/_-]+((?:19|20)\d{2})\b/
  );
  if (monthFirst) {
    return `${MONTH_NAMES[Number(monthFirst[1]) - 1]} ${monthFirst[2]}`;
  }

  return undefined;
}

function getOutputDirectory(
  folder: vscode.WorkspaceFolder
): vscode.Uri {
  const configuredFolder = getOutputFolder(folder.uri);
  const segments = getSafeRelativeSegments(configuredFolder);
  return vscode.Uri.joinPath(folder.uri, ...segments);
}

function getSafeRelativeSegments(value: string): string[] {
  const trimmed = value.trim();
  if (
    !trimmed ||
    /^[\\/]/.test(trimmed) ||
    /^[a-zA-Z]:/.test(trimmed) ||
    trimmed.includes("\0")
  ) {
    throw new NewsletterOutputError(
      "`aviators.output.folder` must be a non-empty workspace-relative path."
    );
  }

  const rawSegments = trimmed.split(/[\\/]+/);
  if (
    rawSegments.some(
      (segment) => segment === ".." || segment.includes(":")
    )
  ) {
    throw new NewsletterOutputError(
      "`aviators.output.folder` cannot contain path traversal or absolute path segments."
    );
  }

  return rawSegments.filter((segment) => segment && segment !== ".");
}

async function selectWorkspaceFolder(
  preferredUris: readonly vscode.Uri[],
  action: string
): Promise<vscode.WorkspaceFolder> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new NewsletterOutputError(
      `Open a workspace folder before trying to ${action}.`
    );
  }

  for (const uri of preferredUris) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
      return folder;
    }
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const activeFolder = activeUri
    ? vscode.workspace.getWorkspaceFolder(activeUri)
    : undefined;
  if (activeFolder) {
    return activeFolder;
  }

  if (folders.length === 1) {
    return folders[0];
  }
  const selected = await vscode.window.showWorkspaceFolderPick({
    placeHolder: `Select the workspace folder where Aviators should ${action}`
  });
  if (!selected) {
    throw new NewsletterOutputError(
      `A workspace folder must be selected to ${action}.`
    );
  }

  return selected;
}

async function readNewsletterSnapshot(
  uri: vscode.Uri
): Promise<{
  readonly originalContent: string | undefined;
  readonly currentContent: string | undefined;
}> {
  const content = await readOptionalTextFile(uri);
  return { originalContent: content, currentContent: content };
}

async function readOptionalTextFile(
  uri: vscode.Uri
): Promise<string | undefined> {
  const openDocument = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString()
  );
  if (openDocument) {
    return openDocument.getText();
  }
  try {
    return textDecoder.decode(await vscode.workspace.fs.readFile(uri));
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function parseNewsletterSections(
  existing: string | undefined,
  uri: vscode.Uri
): NewsletterSections {
  if (!existing?.trim()) {
    return { ...NEWSLETTER_TEMPLATE };
  }

  const sections: NewsletterSections = { ...NEWSLETTER_TEMPLATE };
  const positions = (
    [
      ["aceAviator", "aceaviator"],
      ["productGroup", "productnews"],
      ["community", "communitynews"]
    ] as const
  )
    .map(([section, id]) => ({
      section,
      start: findHeadingStart(existing, id)
    }))
    .filter(
      (
        position
      ): position is { section: NewsletterSection; start: number } =>
        position.start >= 0
    )
    .sort((left, right) => left.start - right.start);

  if (positions.length === 0) {
    const section = detectSection(existing);
    if (!section) {
      throw new NewsletterOutputError(
        `Existing newsletter cannot be safely updated because its sections are not recognizable: ${uri.toString()}`
      );
    }
    sections[section] = existing.trim();
    return sections;
  }

  const prefix = existing.slice(0, positions[0].start).trim();
  if (prefix) {
    sections.toc = prefix;
  }

  for (let index = 0; index < positions.length; index += 1) {
    const current = positions[index];
    const next = positions[index + 1];
    sections[current.section] = existing
      .slice(current.start, next?.start ?? existing.length)
      .trim();
  }

  return sections;
}

function findHeadingStart(html: string, id: string): number {
  return html.search(
    new RegExp(
      `<h[1-6]\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>`,
      "i"
    )
  );
}

function extractHtmlFromToolResult(
  result: Pick<vscode.LanguageModelToolResult, "content">
): string | undefined {
  return findHtml(result.content, new WeakSet<object>(), 0);
}

function findHtml(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): string | undefined {
  if (depth > 8 || value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return findHtmlInText(value, seen, depth + 1);
  }

  if (typeof value !== "object") {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const html = findHtml(item, seen, depth + 1);
      if (html !== undefined) {
        return html;
      }
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.html === "string") {
    return record.html;
  }

  for (const key of ["value", "text", "content"]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const html = findHtml(record[key], seen, depth + 1);
      if (html !== undefined) {
        return html;
      }
    }
  }

  return undefined;
}

function findHtmlInText(
  text: string,
  seen: WeakSet<object>,
  depth: number
): string | undefined {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const objectStart = trimmed.indexOf("{");
  if (objectStart > 0) {
    candidates.push(trimmed.slice(objectStart));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const html = findHtml(parsed, seen, depth + 1);
      if (html !== undefined) {
        return html;
      }
    } catch {
      // Tool text can include a human-readable prefix before its JSON result.
    }
  }

  return undefined;
}

function getToolCallMonth(input: object): string | undefined {
  const value = (input as Record<string, unknown>).month;
  return typeof value === "string" ? normalizeMonthYear(value) : undefined;
}

function findNewsletterReferences(
  references: readonly vscode.ChatPromptReference[]
): vscode.Uri[] {
  return getReferenceUris(references).filter((uri) =>
    uri.path.toLowerCase().endsWith(".html")
  );
}

function getReferenceUris(
  references: readonly vscode.ChatPromptReference[]
): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  for (const reference of references) {
    if (reference.value instanceof vscode.Uri) {
      uris.push(reference.value);
    } else if (reference.value instanceof vscode.Location) {
      uris.push(reference.value.uri);
    }
  }
  return uris;
}

function findNewsletterHistoryAnchors(
  history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]
): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  for (let turnIndex = history.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = history[turnIndex];
    if (!(turn instanceof vscode.ChatResponseTurn)) {
      continue;
    }

    for (
      let partIndex = turn.response.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = turn.response[partIndex];
      if (
        part instanceof vscode.ChatResponseAnchorPart &&
        part.value instanceof vscode.Uri &&
        part.value.path.toLowerCase().endsWith(".html")
      ) {
        uris.push(part.value);
      }
    }
  }
  return uris;
}

function findHistoricalMonth(
  history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]
): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn instanceof vscode.ChatRequestTurn) {
      const monthYear = normalizeMonthYear(turn.prompt);
      if (monthYear) {
        return monthYear;
      }
    }
  }
  return undefined;
}

function getUriDirectory(uri: vscode.Uri): vscode.Uri {
  const slash = uri.path.lastIndexOf("/");
  return uri.with({ path: slash > 0 ? uri.path.slice(0, slash) : "/" });
}

function getUriFileName(uri: vscode.Uri): string {
  const slash = uri.path.lastIndexOf("/");
  return uri.path.slice(slash + 1);
}

function sameUriLocation(left: vscode.Uri, right: vscode.Uri): boolean {
  if (left.scheme !== right.scheme || left.authority !== right.authority) {
    return false;
  }

  return left.scheme === "file"
    ? left.path.toLowerCase() === right.path.toLowerCase()
    : left.path === right.path;
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (isFileNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function openNewsletterUri(uri: vscode.Uri): Promise<void> {
  if (!(await uriExists(uri))) {
    throw new NewsletterOutputError(
      `Newsletter file does not exist: ${uri.toString()}`
    );
  }

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError && error.code === "FileNotFound"
  );
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}
