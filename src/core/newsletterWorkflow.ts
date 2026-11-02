import { randomUUID } from "node:crypto";

export const WORKFLOW_SECTIONS = ["aceAviator", "productGroup", "community"] as const;
export type WorkflowSection = typeof WORKFLOW_SECTIONS[number];
export type WorkflowStatus = "generating" | "staged" | "superseded" | "discarded";

export interface WorkflowSnapshot {
  workflowId: string;
  month: string;
  outputUri: string;
  sections: readonly WorkflowSection[];
  stagedSections: readonly WorkflowSection[];
  status: WorkflowStatus;
  pendingSection?: WorkflowSection;
  community: {
    completedBatches: number;
    pendingBatch: boolean;
    retryRequired: boolean;
    remainingUrls: readonly string[];
    skippedUrls: readonly unknown[];
  };
}

interface WorkflowRecord {
  snapshot: WorkflowSnapshot;
  scrapeInput?: string[];
  pendingScrape?: { hasMore: boolean; remainingUrls: string[]; succeeded: number };
}

/** In-memory target-bound handles; model-supplied cursors are never authority. */
export class NewsletterWorkflowCoordinator {
  private readonly workflows = new Map<string, WorkflowRecord>();
  private readonly targets = new Map<string, string>();

  begin(month: string, target: string, sections: readonly WorkflowSection[]): WorkflowSnapshot {
    if (this.workflows.size >= 100) throw new Error("Workflow limit reached for this editor session. Reload before starting more workflows.");
    if (!Array.isArray(sections) || !sections.length || new Set(sections).size !== sections.length ||
        sections.some(section => !WORKFLOW_SECTIONS.includes(section))) {
      throw new Error("Select one or more unique newsletter sections.");
    }
    const previous = this.targets.get(target);
    if (previous) this.getRecord(previous).snapshot.status = "superseded";
    const selected = WORKFLOW_SECTIONS.filter(section => sections.includes(section));
    const snapshot: WorkflowSnapshot = {
      workflowId: randomUUID(), month, outputUri: target,
      sections: selected, stagedSections: [], status: "generating",
      pendingSection: selected[0],
      community: { completedBatches: 0, pendingBatch: false, retryRequired: false, remainingUrls: [], skippedUrls: [] }
    };
    this.workflows.set(snapshot.workflowId, { snapshot });
    this.targets.set(target, snapshot.workflowId);
    return this.get(snapshot.workflowId);
  }

  get(id: string): WorkflowSnapshot {
    const { snapshot } = this.getRecord(id);
    return {
      ...snapshot, sections: [...snapshot.sections],
      stagedSections: snapshot.community.completedBatches > 0 && !snapshot.stagedSections.includes("community")
        ? [...snapshot.stagedSections, "community"] : [...snapshot.stagedSections],
      community: { ...snapshot.community, remainingUrls: [...snapshot.community.remainingUrls],
        skippedUrls: [...snapshot.community.skippedUrls] }
    };
  }

  assertNext(id: string, section: WorkflowSection): void {
    const { snapshot } = this.getRecord(id);
    if (snapshot.status !== "generating" || snapshot.pendingSection !== section)
      throw new Error(`Workflow is ${snapshot.status}; next section is ${snapshot.pendingSection ?? "none"}.`);
  }

  startScrape(id: string, urls: readonly string[]): void {
    this.assertNext(id, "community");
    const record = this.getRecord(id);
    if (record.pendingScrape || record.scrapeInput)
      throw new Error("Stage the prior Community batch before requesting another scrape.");
    if (!urls.length || new Set(urls).size !== urls.length)
      throw new Error("Scrape URLs must be non-empty and unique.");
    const expected = record.snapshot.community.remainingUrls;
    if ((record.snapshot.community.completedBatches > 0 || record.snapshot.community.retryRequired) &&
        !sameUrls(urls, expected))
      throw new Error("Continuation URLs do not match the trusted remaining URLs.");
    record.scrapeInput = [...urls];
  }

  finishScrape(id: string, result: unknown): void {
    this.assertNext(id, "community");
    const record = this.getRecord(id);
    const input = record.scrapeInput;
    record.scrapeInput = undefined;
    if (!input || !isRecord(result) || typeof result.success !== "boolean" ||
        typeof result.hasMore !== "boolean" || !Array.isArray(result.remainingUrls) ||
        !result.remainingUrls.every((url): url is string => typeof url === "string") ||
        !Array.isArray(result.items) || !Number.isSafeInteger(result.batchSize) ||
        typeof result.batchSize !== "number" || result.batchSize <= 0 ||
        result.batchSize > input.length || !Number.isSafeInteger(result.succeeded) ||
        typeof result.succeeded !== "number" || result.succeeded < 0 ||
        result.succeeded > result.batchSize ||
        result.success !== (result.succeeded > 0) ||
        !sameUrls(result.remainingUrls, input.slice(result.batchSize)) ||
        result.hasMore !== (result.remainingUrls.length > 0) ||
        result.items.length !== result.batchSize ||
        result.items.some((item, index) => !isRecord(item) || item.url !== input[index] ||
          typeof item.success !== "boolean") ||
        result.items.filter(item => isRecord(item) && item.success === true).length !== result.succeeded) {
      throw new Error("Scrape returned invalid trusted batch progress; retry the same URLs.");
    }
    record.snapshot.community.skippedUrls = [
      ...record.snapshot.community.skippedUrls,
      ...result.items.filter(item => isRecord(item) && item.success === false)
    ];
    if (result.succeeded === 0) {
      record.snapshot.community.retryRequired = true;
      record.snapshot.community.pendingBatch = false;
      record.snapshot.community.remainingUrls = [...input];
      return;
    }
    record.snapshot.community.retryRequired = false;
    record.pendingScrape = {
      hasMore: result.hasMore, remainingUrls: [...result.remainingUrls], succeeded: result.succeeded
    };
    record.snapshot.community.pendingBatch = true;
  }

  failScrape(id: string): void {
    this.getRecord(id).scrapeInput = undefined;
  }

  communityProgress(id: string, itemCount: number): boolean {
    this.assertNext(id, "community");
    const record = this.getRecord(id);
    if (record.snapshot.community.retryRequired)
      throw new Error("The Community scrape failed for every URL. Retry scrapeLinkedIn with the workflow's trusted remainingUrls before generating; existing Community was preserved.");
    const pending = record.pendingScrape;
    if (!pending) throw new Error("Scrape a Community batch in this workflow before generating it.");
    if (!Number.isSafeInteger(itemCount) || itemCount < 0)
      throw new Error("Invalid Community batch item count.");
    return pending.hasMore;
  }

  staged(id: string, section: WorkflowSection): void {
    this.assertNext(id, section);
    const record = this.getRecord(id);
    if (section === "community") {
      const pending = record.pendingScrape;
      if (!pending) throw new Error("There is no trusted Community batch to stage.");
      record.snapshot.community.completedBatches++;
      record.snapshot.community.pendingBatch = false;
      record.snapshot.community.remainingUrls = [...pending.remainingUrls];
      record.pendingScrape = undefined;
      if (pending.hasMore) return;
    }
    record.snapshot.stagedSections = [...record.snapshot.stagedSections, section];
    record.snapshot.pendingSection = record.snapshot.sections[record.snapshot.stagedSections.length];
    if (!record.snapshot.pendingSection) record.snapshot.status = "staged";
  }

  discard(id: string): void {
    this.getRecord(id).snapshot.status = "discarded";
  }

  private getRecord(id: string): WorkflowRecord {
    const record = this.workflows.get(id);
    if (!record) throw new Error("Unknown workflow handle. After extension reload, begin a new workflow.");
    return record;
  }
}

function sameUrls(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((url, index) => url === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
