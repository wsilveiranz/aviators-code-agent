import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import {
  NewsletterWorkflowCoordinator, WORKFLOW_SECTIONS, type WorkflowSection, type WorkflowSnapshot
} from "../core/newsletterWorkflow.js";
import { detectSection } from "../core/newsletter.js";
import { findCommunityNewsBatchResult } from "../skills/communityNews.js";
import { readCommunityScrapeInput, type CommunityGenerationRun } from "./communityGeneration.js";
import { NewsletterOutputManager, normalizeMonthYear } from "./output.js";

export const SHOW_WORKFLOW_STATUS_COMMAND = "aviators.showNewsletterWorkflowStatus";
export interface NewsletterTargetInput {
  month: string;
  fileName?: string;
  workspaceFolder?: string;
}
export interface BeginNewsletterInput extends NewsletterTargetInput {
  sections: WorkflowSection[];
}
export interface NewsletterWorkflowResult extends WorkflowSnapshot {
  path: string;
  proposalId?: string;
  stagingStatus: WorkflowSnapshot["status"];
  applyStatus: "none" | "pending" | "applied" | "discarded";
  saved: boolean;
  pending: boolean;
  draftSections: readonly WorkflowSection[];
}

interface WorkflowTarget {
  uri: vscode.Uri;
  folder: vscode.WorkspaceFolder;
  proposalId: string;
  generation: CommunityGenerationRun;
}

export class NewsletterWorkflowRuntime {
  private readonly coordinator = new NewsletterWorkflowCoordinator();
  private readonly targets = new Map<string, WorkflowTarget>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly output: NewsletterOutputManager) {}

  async begin(input: BeginNewsletterInput): Promise<NewsletterWorkflowResult> {
    const target = await this.output.resolveWorkflowTarget(input);
    return this.enqueue(targetKey(target.uri), () => this.output.withTargetLock(target.uri, async () => {
      const previous = [...this.targets.entries()].filter(([, value]) =>
        targetKey(value.uri) === targetKey(target.uri));
      const current = previous.at(-1);
      if (current && this.output.hasPendingProposal(current[1].proposalId) &&
          this.coordinator.get(current[0]).month !== target.month)
        throw new Error("This target has a pending draft for another month. Persist or discard it before changing the newsletter month.");
      if (current && this.coordinator.get(current[0]).status === "generating" &&
          this.output.hasPendingProposal(current[1].proposalId)) {
        throw new Error("Complete the active workflow and all pending batches, or explicitly discard the draft before starting another section.");
      }
      const proposalId = current && this.output.hasPendingProposal(current[1].proposalId)
        ? current[1].proposalId : randomUUID();
      const snapshot = this.coordinator.begin(target.month, targetKey(target.uri), input.sections);
      for (const [, value] of previous) {
        this.output.abandonCommunityGeneration(value.generation.generationId);
      }
      this.targets.set(snapshot.workflowId, {
        uri: target.uri, folder: target.folder, proposalId,
        generation: this.output.startCommunityGeneration()
      });
      this.bindProposal(snapshot.workflowId);
      return this.get(snapshot.workflowId);
    }));
  }

  async createTemplate(input: NewsletterTargetInput): Promise<object> {
    const target = await this.output.resolveWorkflowTarget(input);
    return this.enqueue(targetKey(target.uri), async () => {
      const result = await this.output.ensureTemplate(target.uri, target.folder);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target.uri));
      return { month: target.month, outputUri: result.uri.toString(), path: result.uri.fsPath,
        created: result.created, status: result.created ? "created" : "opened" };
    });
  }

  get(workflowId: string): NewsletterWorkflowResult {
    const snapshot = this.coordinator.get(workflowId);
    const target = this.getTarget(workflowId);
    const proposal = this.output.getProposalStatus(target.proposalId);
    const staged = new Set([...this.targets.entries()]
      .filter(([, value]) => value.proposalId === target.proposalId)
      .flatMap(([id]) => this.coordinator.get(id).stagedSections));
    return {
      ...snapshot, outputUri: target.uri.toString(), path: target.uri.fsPath,
      proposalId: proposal.status === "none" ? undefined : target.proposalId,
      stagingStatus: snapshot.status,
      applyStatus: proposal.status,
      saved: proposal.saved,
      pending: snapshot.status === "generating",
      draftSections: WORKFLOW_SECTIONS.filter(section => staged.has(section))
    };
  }

  async review(workflowId: string): Promise<object> {
    const target = this.getTarget(workflowId);
    this.assertActive(workflowId);
    await this.output.reviewProposal(target.proposalId);
    return this.get(workflowId);
  }

  async persist(workflowId?: string, token?: vscode.CancellationToken): Promise<object> {
    let selected: string | undefined;
    if (workflowId !== undefined) {
      if (typeof workflowId !== "string" || !workflowId) throw new Error("Invalid workflow identifier.");
      const target = this.getTarget(workflowId);
      selected = this.currentWorkflow(target.uri);
    } else {
      const current = new Map<string, string>();
      for (const [id, target] of this.targets) current.set(targetKey(target.uri), id);
      const items = [...current.values()].filter(id =>
        this.output.hasPendingProposal(this.getTarget(id).proposalId)
      ).map(id => ({
        label: this.getTarget(id).uri.fsPath,
        detail: this.get(id).month,
        workflowId: id
      }));
      if (!items.length) throw new Error("No pending newsletter drafts to persist.");
      selected = items.length === 1 ? items[0].workflowId :
        (await vscode.window.showQuickPick(items, { title: "Aviators: Select newsletter draft to persist" }))?.workflowId;
      if (selected === undefined) throw new vscode.CancellationError();
    }
    const target = this.getTarget(selected);
    return this.enqueue(targetKey(target.uri), async () => {
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      const currentId = this.currentWorkflow(target.uri);
      this.assertActive(currentId);
      if (this.coordinator.get(currentId).status !== "staged")
        throw new Error("Complete the active workflow and all pending batches before persisting the draft.");
      await this.output.applyProposal(this.getTarget(currentId).proposalId, token);
      return this.get(currentId);
    });
  }

  async preview(workflowId?: string): Promise<object> {
    if (workflowId !== undefined) this.assertActive(workflowId, true);
    const uri = await this.output.openNewsletter(
      workflowId === undefined ? undefined : this.getTarget(workflowId).uri
    );
    return { outputUri: uri.toString(), path: uri.fsPath };
  }

  async showStatus(value?: unknown): Promise<void> {
    let id: string | undefined;
    if (value !== undefined) {
      if (typeof value !== "string") throw new Error("Invalid workflow identifier.");
      id = value;
    } else {
      const items = [...this.targets.entries()].map(([workflowId, target]) => {
        const status = this.coordinator.get(workflowId);
        return { label: `${status.month}: ${status.status}`, detail: target.uri.toString(), workflowId };
      });
      if (!items.length) throw new Error("No newsletter workflows in this editor session.");
      id = (await vscode.window.showQuickPick(items, { title: "Aviators: Workflow status" }))?.workflowId;
    }
    if (id === undefined) return;
    const selectedId = id;
    const snapshot = this.coordinator.get(selectedId);
    const target = this.getTarget(selectedId);
    const proposal = this.output.getProposalStatus(target.proposalId);
    const review = await vscode.window.showInformationMessage(
      `${snapshot.month}: ${snapshot.status}; staged ${snapshot.stagedSections.join(", ") || "none"}; ` +
      `next ${snapshot.pendingSection ?? "none"}; Community pending batch ${snapshot.community.pendingBatch}, ` +
      `retry required ${snapshot.community.retryRequired}, ` +
      `remaining URLs ${snapshot.community.remainingUrls.length}, skipped ${snapshot.community.skippedUrls.length}; ` +
      `proposal ${proposal.status}; saved ${proposal.saved}.`,
      ...(proposal.status === "pending" ? ["Review changes"] : [])
    );
    if (review === "Review changes") await this.review(selectedId);
  }

  async execute<T extends object>(
    name: string, input: T & { workflowId?: string },
    execute: (input: T) => Promise<unknown>,
    token?: vscode.CancellationToken
  ): Promise<unknown> {
    const { workflowId, ...parameters } = input;
    if (workflowId === undefined) return execute(input);
    if (typeof workflowId !== "string" || !workflowId) throw new Error("Invalid workflow identifier.");
    const target = this.getTarget(workflowId);
    return this.enqueue(targetKey(target.uri), async () => {
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      this.assertActive(workflowId);
      const section = sectionForTool(name);
      const snapshot = this.coordinator.get(workflowId);
      const month = Reflect.get(parameters, "month");
      if (month !== undefined && (typeof month !== "string" || normalizeMonthYear(month) !== snapshot.month))
        throw new Error("The generated section month does not match the workflow.");
      if (name === "scrapeLinkedIn") {
        const urls = readCommunityScrapeInput(parameters);
        const rawUrls: unknown = Reflect.get(parameters, "urls");
        const inputJson: unknown = Reflect.get(parameters, "inputJson");
        const batchSize = Reflect.get(parameters, "batchSize");
        const originalUrls: unknown = rawUrls ?? (typeof inputJson === "string" ? JSON.parse(inputJson) as unknown : undefined);
        if (!urls || !Array.isArray(originalUrls) || originalUrls.length !== urls.length ||
            (batchSize !== undefined && (typeof batchSize !== "number" || !Number.isSafeInteger(batchSize) ||
              batchSize < 1 || batchSize > 500)))
          throw new Error("Invalid or duplicate scrape URLs/batch size.");
        Reflect.set(parameters, "urls", urls);
        Reflect.deleteProperty(parameters, "inputJson");
        this.coordinator.startScrape(workflowId, urls);
        try {
          const result = await execute(parameters as T);
          if (token?.isCancellationRequested) throw new vscode.CancellationError();
          this.coordinator.finishScrape(workflowId, result);
          this.output.recordCommunityScrapeStarted(target.generation.generationId, parameters);
          this.output.recordCommunityScrapeResult(target.generation.generationId, result);
          return { result, workflow: this.get(workflowId) };
        } catch (error) {
          this.coordinator.failScrape(workflowId);
          throw error;
        }
      }
      if (!section) throw new Error("This tool does not support newsletter workflow staging.");
      this.coordinator.assertNext(workflowId, section);
      if (section === "community") {
        const items: unknown = Reflect.get(parameters, "items");
        if (!Array.isArray(items)) throw new Error("Community items must be an array.");
        const hasMore = this.coordinator.communityProgress(workflowId, items.length);
        const supplied = Reflect.get(parameters, "hasMore");
        if (supplied !== undefined && supplied !== hasMore)
          throw new Error("Community hasMore conflicts with the actual scrape result.");
        Reflect.set(parameters, "hasMore", hasMore);
      }
      const result = await execute(parameters as T);
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      if (!isRecord(result) || result.success !== true)
        throw new Error(`Generation failed: ${isRecord(result) ? String(result.error ?? "invalid result") : "invalid result"}`);
      const commitWorkflow = () => {
        this.coordinator.staged(workflowId, section);
        this.bindProposal(workflowId);
      };
      if (section === "community") {
        const batch = findCommunityNewsBatchResult(result);
        if (!batch) throw new Error("Invalid Community batch result.");
        const write = target.generation.prepareBatch(target.uri.toString());
        await this.output.writeCommunityBatch(target.proposalId, target.uri,
          batch.items, batch.hasMore, target.folder, write, token, () => {
            target.generation.markBatchPersisted(target.uri.toString(), write);
            commitWorkflow();
          });
      } else {
        if (typeof result.html !== "string" || detectSection(result.html) !== section)
          throw new Error("The generated HTML does not identify the expected newsletter section.");
        await this.output.writeSection(target.proposalId, target.uri, section, result.html, target.folder, token, commitWorkflow);
      }
      return { result, workflow: this.get(workflowId) };
    });
  }

  private assertActive(id: string, allowApplied = false): void {
    const snapshot = this.coordinator.get(id);
    if (snapshot.status === "superseded" || snapshot.status === "discarded")
      throw new Error(`The newsletter workflow is ${snapshot.status}. Begin a new workflow.`);
    const target = this.getTarget(id);
    if (!vscode.workspace.workspaceFolders?.some(folder => folder.uri.toString() === target.folder.uri.toString()) ||
        !this.output.isOutputUri(target.folder, target.uri))
      throw new Error("The workflow workspace/target is no longer available or safe.");
    if (!allowApplied && this.output.getProposalStatus(target.proposalId).status === "applied")
      throw new Error("This workflow was already applied; begin a new workflow to generate changes.");
  }

  private getTarget(id: string): WorkflowTarget {
    this.coordinator.get(id);
    const target = this.targets.get(id);
    if (!target) throw new Error("Unknown workflow target.");
    return target;
  }

  private currentWorkflow(uri: vscode.Uri): string {
    const current = [...this.targets.entries()].filter(([, target]) =>
      targetKey(target.uri) === targetKey(uri)).at(-1);
    if (!current) throw new Error("No active newsletter workflow for this target.");
    return current[0];
  }

  private bindProposal(workflowId: string): void {
    const target = this.getTarget(workflowId);
    this.output.setProposalDiscardHandler(target.proposalId, () => {
      this.coordinator.discard(workflowId);
      this.output.abandonCommunityGeneration(target.generation.generationId);
    }, true);
    this.output.setProposalApplyGuard(target.proposalId, () =>
      this.coordinator.get(workflowId).status === "staged");
  }

  private async enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(key) ?? Promise.resolve()).then(operation);
    const completion = result.then(() => undefined, () => undefined);
    this.queues.set(key, completion);
    try { return await result; }
    finally { if (this.queues.get(key) === completion) this.queues.delete(key); }
  }
}

function sectionForTool(name: string): WorkflowSection | undefined {
  switch (name) {
    case "createAceAviator": return "aceAviator";
    case "createProductGroupNews": return "productGroup";
    case "createCommunityNews": return "community";
    default: return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function targetKey(uri: vscode.Uri): string {
  return uri.scheme === "file" ? uri.toString().toLowerCase() : uri.toString();
}

export function readNewsletterToolObject(content: readonly unknown[]): Record<string, unknown> | undefined {
  for (const part of content) {
    const text: unknown = typeof part === "string" ? part :
      isRecord(part) ? part.value ?? part.text : undefined;
    if (typeof text !== "string") continue;
    const start = text.indexOf("{");
    if (start < 0) continue;
    try {
      const parsed: unknown = JSON.parse(text.slice(start));
      if (isRecord(parsed)) return parsed;
    } catch {
      // Only full structured tool output is evidence; truncated text is not state.
    }
  }
  return undefined;
}
