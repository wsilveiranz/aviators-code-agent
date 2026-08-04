import { randomBytes } from "node:crypto";

import {
  filterValidItems,
  generateHTML,
  type CommunityBatchItem
} from "../core/communityNews.js";

const COMMUNITY_RESUME_VERSION = 1;
const MAX_RESUME_URLS = 500;
const MAX_RESUME_URL_LENGTH = 4096;

export interface CommunityBatchWrite {
  readonly generation: string;
  readonly continuation: boolean;
  readonly expectedBatch: number;
}

export interface PreparedCommunityBatch {
  readonly generation: string;
  readonly items: readonly CommunityBatchItem[];
  readonly html: string;
}

export interface CommunityResumeCursor {
  readonly kind: "linkedInUrls";
  readonly urls: readonly string[];
  readonly completedBatches: number;
}

export interface CommunityResumeMetadata {
  readonly version: 1;
  readonly generationId: string;
  readonly state: "pending";
  readonly hasMore: true;
  readonly cursor: CommunityResumeCursor;
}

export interface CommunityBatchProgress {
  readonly hasMore: boolean;
}

interface ActiveCommunityGeneration {
  readonly generation: string;
  readonly items: readonly CommunityBatchItem[];
}

interface CommunityGenerationRecord {
  readonly generationId: string;
  target?: string;
  completedBatches: number;
  hasMore: boolean;
  complete: boolean;
  superseded: boolean;
  safeCursor?: string[];
  nextCursor?: string[];
}

interface CommunityScrapeCursor {
  readonly hasMore: boolean;
  readonly remainingUrls: readonly string[];
}

export class CommunityGenerationConflictError extends Error {
  constructor() {
    super(
      "This Community News continuation belongs to an inactive generation and was not saved."
    );
    this.name = "CommunityGenerationConflictError";
  }
}

export class CommunityGenerationRun {
  private readonly persistedTargets: Set<string>;
  private completedBatches: number;

  constructor(
    readonly generationId: string = createGenerationId(),
    persistedTargets: Iterable<string> = [],
    completedBatches = 0
  ) {
    this.persistedTargets = new Set(persistedTargets);
    this.completedBatches = completedBatches;
  }

  prepareBatch(target: string): CommunityBatchWrite {
    return {
      generation: this.generationId,
      continuation: this.persistedTargets.has(target),
      expectedBatch: this.completedBatches
    };
  }

  markBatchPersisted(
    target: string,
    write: CommunityBatchWrite
  ): void {
    if (
      write.generation !== this.generationId ||
      write.continuation !== this.persistedTargets.has(target) ||
      write.expectedBatch !== this.completedBatches
    ) {
      throw new CommunityGenerationConflictError();
    }
    this.persistedTargets.add(target);
    this.completedBatches += 1;
  }
}

export class CommunityGenerationCoordinator {
  private readonly activeByTarget = new Map<
    string,
    ActiveCommunityGeneration
  >();
  private readonly generations = new Map<
    string,
    CommunityGenerationRecord
  >();

  startGeneration(): CommunityGenerationRun {
    const run = new CommunityGenerationRun();
    this.generations.set(
      run.generationId,
      createGenerationRecord(run.generationId)
    );
    return run;
  }

  resumeGeneration(value: unknown): CommunityGenerationRun | undefined {
    const metadata = readCommunityResumeMetadata(value);
    if (!metadata) {
      return undefined;
    }

    const record = this.generations.get(metadata.generationId);
    if (
      !record ||
      record.complete ||
      record.superseded ||
      record.hasMore !== true ||
      !record.safeCursor ||
      record.completedBatches !== metadata.cursor.completedBatches ||
      !sameStringArray(record.safeCursor, metadata.cursor.urls)
    ) {
      return undefined;
    }

    return new CommunityGenerationRun(
      record.generationId,
      record.target && record.completedBatches > 0
        ? [record.target]
        : [],
      record.completedBatches
    );
  }

  getResumeMetadata(
    generationId: string
  ): CommunityResumeMetadata | undefined {
    const record = this.generations.get(generationId);
    if (
      !record ||
      record.complete ||
      record.superseded ||
      !record.hasMore ||
      !record.safeCursor ||
      record.safeCursor.length === 0
    ) {
      return undefined;
    }

    return {
      version: COMMUNITY_RESUME_VERSION,
      generationId: record.generationId,
      state: "pending",
      hasMore: true,
      cursor: {
        kind: "linkedInUrls",
        urls: [...record.safeCursor],
        completedBatches: record.completedBatches
      }
    };
  }

  hasPendingGeneration(generationId: string): boolean {
    const record = this.generations.get(generationId);
    return Boolean(
      record &&
      !record.complete &&
      !record.superseded &&
      record.hasMore
    );
  }

  abandonGeneration(generationId: string): void {
    const record = this.generations.get(generationId);
    if (!record) {
      return;
    }
    record.superseded = true;
    record.safeCursor = undefined;
    record.nextCursor = undefined;
    if (
      record.target &&
      this.activeByTarget.get(record.target)?.generation === generationId
    ) {
      this.activeByTarget.delete(record.target);
    }
  }

  getGenerationTarget(generationId: string): string | undefined {
    return this.generations.get(generationId)?.target;
  }

  recordScrapeStarted(
    generationId: string,
    input: unknown
  ): void {
    const record = this.getWritableRecord(generationId);
    const urls = readCommunityScrapeInput(input);
    if (!record || !urls) {
      return;
    }

    if (record.completedBatches === 0 && !record.safeCursor) {
      record.safeCursor = urls;
      record.hasMore = true;
    }
    record.nextCursor = undefined;
  }

  recordScrapeResult(
    generationId: string,
    value: unknown
  ): void {
    const record = this.getWritableRecord(generationId);
    const cursor = findCommunityScrapeCursor(value);
    if (!record || !cursor) {
      return;
    }

    record.nextCursor = cursor.hasMore
      ? [...cursor.remainingUrls]
      : [];
  }

  prepareBatch(
    target: string,
    write: CommunityBatchWrite,
    items: readonly CommunityBatchItem[]
  ): PreparedCommunityBatch {
    const active = this.activeByTarget.get(target);
    const record = this.getOrCreateRecord(write.generation);
    if (
      record.complete ||
      record.superseded ||
      record.completedBatches !== write.expectedBatch ||
      (record.target !== undefined && record.target !== target) ||
      (write.continuation &&
        active?.generation !== write.generation)
    ) {
      throw new CommunityGenerationConflictError();
    }

    const accumulatedItems = filterValidItems([
      ...(write.continuation ? active?.items ?? [] : []),
      ...items
    ]);
    return {
      generation: write.generation,
      items: accumulatedItems,
      html: generateHTML(accumulatedItems)
    };
  }

  commitBatch(
    target: string,
    write: CommunityBatchWrite,
    prepared: PreparedCommunityBatch,
    progress?: CommunityBatchProgress
  ): void {
    const active = this.activeByTarget.get(target);
    const record = this.getOrCreateRecord(write.generation);
    if (
      prepared.generation !== write.generation ||
      record.complete ||
      record.superseded ||
      record.completedBatches !== write.expectedBatch ||
      (record.target !== undefined && record.target !== target) ||
      (write.continuation &&
        active?.generation !== write.generation)
    ) {
      throw new CommunityGenerationConflictError();
    }

    if (active && active.generation !== write.generation) {
      const superseded = this.generations.get(active.generation);
      if (superseded) {
        superseded.superseded = true;
        superseded.safeCursor = undefined;
        superseded.nextCursor = undefined;
      }
    }

    this.activeByTarget.set(target, {
      generation: write.generation,
      items: [...prepared.items]
    });
    record.target = target;
    record.completedBatches += 1;

    if (progress) {
      record.hasMore = progress.hasMore;
      record.complete = !progress.hasMore;
      record.safeCursor =
        progress.hasMore && record.nextCursor?.length
          ? [...record.nextCursor]
          : undefined;
      record.nextCursor = undefined;
    }
  }

  private getWritableRecord(
    generationId: string
  ): CommunityGenerationRecord | undefined {
    const record = this.generations.get(generationId);
    return record && !record.complete && !record.superseded
      ? record
      : undefined;
  }

  private getOrCreateRecord(
    generationId: string
  ): CommunityGenerationRecord {
    const existing = this.generations.get(generationId);
    if (existing) {
      return existing;
    }

    const created = createGenerationRecord(generationId);
    this.generations.set(generationId, created);
    return created;
  }
}

export function readCommunityResumeMetadata(
  value: unknown
): CommunityResumeMetadata | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version",
    "generationId",
    "state",
    "hasMore",
    "cursor"
  ])) {
    return undefined;
  }

  const cursor = value.cursor;
  if (
    value.version !== COMMUNITY_RESUME_VERSION ||
    typeof value.generationId !== "string" ||
    !/^[A-Za-z0-9_-]{32}$/.test(value.generationId) ||
    value.state !== "pending" ||
    value.hasMore !== true ||
    !isRecord(cursor) ||
    !hasExactKeys(cursor, [
      "kind",
      "urls",
      "completedBatches"
    ]) ||
    cursor.kind !== "linkedInUrls" ||
    !Number.isSafeInteger(cursor.completedBatches) ||
    (cursor.completedBatches as number) < 0
  ) {
    return undefined;
  }

  const urls = readSafeUrlArray(cursor.urls);
  if (!urls || urls.length === 0) {
    return undefined;
  }

  return {
    version: COMMUNITY_RESUME_VERSION,
    generationId: value.generationId,
    state: "pending",
    hasMore: true,
    cursor: {
      kind: "linkedInUrls",
      urls,
      completedBatches: cursor.completedBatches as number
    }
  };
}

export function readCommunityScrapeInput(
  value: unknown
): string[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.urls !== undefined) {
    return readSafeUrlArray(value.urls);
  }

  if (typeof value.inputJson !== "string") {
    return undefined;
  }

  try {
    return readSafeUrlArray(JSON.parse(value.inputJson) as unknown);
  } catch {
    return undefined;
  }
}

export function findCommunityScrapeCursor(
  value: unknown
): CommunityScrapeCursor | undefined {
  return findScrapeCursor(value, new WeakSet<object>(), 0);
}

function findScrapeCursor(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): CommunityScrapeCursor | undefined {
  if (depth > 8 || value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    for (const candidate of jsonCandidates(value)) {
      try {
        const cursor = findScrapeCursor(
          JSON.parse(candidate) as unknown,
          seen,
          depth + 1
        );
        if (cursor) {
          return cursor;
        }
      } catch {
        // Tool text can include a display prefix before its JSON result.
      }
    }
    return undefined;
  }

  if (typeof value !== "object" || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const cursor = findScrapeCursor(item, seen, depth + 1);
      if (cursor) {
        return cursor;
      }
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    record.success === true &&
    typeof record.hasMore === "boolean"
  ) {
    const remainingUrls = readSafeUrlArray(record.remainingUrls);
    if (
      remainingUrls &&
      (record.hasMore ? remainingUrls.length > 0 : remainingUrls.length === 0)
    ) {
      return {
        hasMore: record.hasMore,
        remainingUrls
      };
    }
  }

  for (const key of ["value", "text", "content"]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const cursor = findScrapeCursor(
        record[key],
        seen,
        depth + 1
      );
      if (cursor) {
        return cursor;
      }
    }
  }

  return undefined;
}

function createGenerationId(): string {
  return randomBytes(24).toString("base64url");
}

function createGenerationRecord(
  generationId: string
): CommunityGenerationRecord {
  return {
    generationId,
    completedBatches: 0,
    hasMore: false,
    complete: false,
    superseded: false
  };
}

function readSafeUrlArray(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAX_RESUME_URLS
  ) {
    return undefined;
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item.length > MAX_RESUME_URL_LENGTH
    ) {
      return undefined;
    }

    let parsed: URL;
    try {
      parsed = new URL(item);
    } catch {
      return undefined;
    }
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }

    const normalized = parsed.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }

  return urls;
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return sameStringArray(actual, expected);
}

function jsonCandidates(value: string): string[] {
  const trimmed = value.trim();
  const candidates = [trimmed];
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index > 0);
  if (starts.length > 0) {
    candidates.push(trimmed.slice(Math.min(...starts)));
  }
  return candidates;
}
