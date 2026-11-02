import { strict as assert } from "node:assert";
import type * as vscode from "vscode";

class Uri {
  constructor(readonly scheme: string, readonly authority: string, readonly path: string) {}
  static parse(value: string): Uri {
    const parsed = new URL(value);
    return new Uri(parsed.protocol.slice(0, -1), parsed.host, parsed.pathname);
  }
  static from(value: { scheme: string; authority?: string; path: string }): Uri {
    return new Uri(value.scheme, value.authority ?? "", value.path);
  }
  static joinPath(uri: Uri, ...segments: string[]): Uri {
    return Uri.parse(`${uri.toString()}/${segments.join("/")}`);
  }
  toString(): string { return `${this.scheme}://${this.authority}${this.path}`; }
  get fsPath(): string { return this.path.replace(/\//g, "\\"); }
  with(value: { path: string }): Uri { return new Uri(this.scheme, this.authority, value.path); }
}

const files = new Map<string, string>();
class FileSystemError extends Error {
  readonly code = "FileNotFound";
}
let saveSucceeds = true;
let saveBarrier: Promise<void> | undefined;
let onSaveStarted: (() => void) | undefined;
let folderSetting = "newsletters";
let readBarrier: Promise<void> | undefined;
let onReadStarted: (() => void) | undefined;
let nativeFails = false;
class Document {
  isDirty = false;
  constructor(readonly uri: Uri, public text: string) {}
  getText(): string { return this.text; }
  positionAt(offset: number): number { return offset; }
  async save(): Promise<boolean> {
    onSaveStarted?.();
    if (saveBarrier) await saveBarrier;
    if (!saveSucceeds) return false;
    files.set(this.uri.toString(), this.text);
    this.isDirty = false;
    return true;
  }
}
const documents: Document[] = [];
const folder = { uri: Uri.parse("file:///workspace"), name: "workspace", index: 0 };
const tools = new Map<string, vscode.LanguageModelTool<object>>();
const commandCalls: string[] = [];
const forwardedTokens: unknown[] = [];
let pickFirst = true;
let pickerCalls = 0;
class WorkspaceEdit {
  changes: { uri: Uri; text: string }[] = [];
  createFile(): void {}
  insert(uri: Uri, _position: unknown, text: string): void { this.changes.push({ uri, text }); }
  replace(uri: Uri, _range: unknown, text: string): void { this.changes.push({ uri, text }); }
}
const mock = {
  Uri, WorkspaceEdit, FileSystemError,
  Position: class {}, Range: class {},
  EventEmitter: class { event = () => undefined; fire(): void {} },
  LanguageModelTextPart: class { constructor(readonly value: string) {} },
  LanguageModelToolResult: class { constructor(readonly content: unknown[]) {} },
  LanguageModelToolCallPart: class {
    constructor(readonly callId: string, readonly name: string, readonly input: object) {}
  },
  LanguageModelToolResultPart: class {
    constructor(readonly callId: string, readonly content: unknown[]) {}
  },
  LanguageModelDataPart: class {},
  LanguageModelChatMessage: class {
    static User(value: unknown) { return { role: 1, content: Array.isArray(value) ? value : [{ value }] }; }
    static Assistant(value: unknown) { return { role: 2, content: Array.isArray(value) ? value : [{ value }] }; }
  },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  CancellationTokenSource: class {
    token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    cancel() { this.token.isCancellationRequested = true; }
    dispose() {}
  },
  CancellationError: class extends Error {},
  workspace: {
    workspaceFolders: [folder],
    textDocuments: documents,
    getWorkspaceFolder(uri: Uri) { return uri.path.startsWith("/workspace/") ? folder : undefined; },
    getConfiguration() { return { get(_key: string, fallback: unknown) { return _key === "output.folder" ? folderSetting : fallback; } }; },
    async openTextDocument(uri: Uri) {
      let document = documents.find(item => item.uri.toString() === uri.toString());
      if (!document) {
        document = new Document(uri, files.get(uri.toString()) ?? "");
        documents.push(document);
      }
      return document;
    },
    async applyEdit(edit: WorkspaceEdit) {
      for (const change of edit.changes) {
        const document = await mock.workspace.openTextDocument(change.uri);
        document.text = change.text;
        document.isDirty = true;
      }
      return true;
    },
    fs: {
      async createDirectory() {},
      async readFile(uri: Uri) {
        onReadStarted?.();
        if (readBarrier) await readBarrier;
        const content = files.get(uri.toString());
        if (content === undefined) throw new FileSystemError("not found");
        return new TextEncoder().encode(content);
      },
      async writeFile(uri: Uri, data: Uint8Array) { files.set(uri.toString(), new TextDecoder().decode(data)); },
      async stat(uri: Uri) {
        if (!files.has(uri.toString())) throw new FileSystemError("not found");
        return { type: 1 };
      }
    }
  },
  commands: { async executeCommand(name: string) { commandCalls.push(name); } },
  window: {
    async showTextDocument() {},
    async showQuickPick<T>(items: T[]) { pickerCalls++; return pickFirst ? items[0] : undefined; },
    async showInformationMessage() { return undefined; }
  },
  lm: {
    tools: [] as { name: string; description: string; inputSchema: object }[],
    async invokeTool(_name: string, options: { toolInvocationToken: unknown; input?: object }, cancellation = token) {
      const registered = tools.get(_name);
      if (registered) {
        const result = await registered.invoke({
          input: options.input ?? {},
          toolInvocationToken: options.toolInvocationToken as vscode.ChatParticipantToolToken
        }, cancellation);
        assert.ok(result);
        return result;
      }
      forwardedTokens.push(options.toolInvocationToken);
      if (nativeFails) throw new Error("Fixture source retrieval denied.");
      return { content: [{ value: "Retrieved fixture snapshot" }] };
    },
    registerTool(name: string, tool: vscode.LanguageModelTool<object>) {
      tools.set(name, tool);
      return { dispose() {} };
    }
  }
};

const loader = require("node:module") as {
  _load: (id: string, parent: unknown, main: boolean) => unknown
};
const originalLoad = loader._load;
loader._load = (id, parent, main) =>
  id === "vscode" ? mock : id.endsWith(".md") ? "" : originalLoad(id, parent, main);
const { NewsletterOutputManager } = require("../src/extension/output.js") as typeof import("../src/extension/output.js");
const { NewsletterWorkflowRuntime } = require("../src/extension/workflowRuntime.js") as typeof import("../src/extension/workflowRuntime.js");
const { registerNewsletterLanguageModelTools, getAvailableLanguageModelChatTools } =
  require("../src/extension/toolRegistry.js") as typeof import("../src/extension/toolRegistry.js");
const { createNewsletterChatRequestHandler, NewsletterChatFollowupProvider } =
  require("../src/extension/participant.js") as typeof import("../src/extension/participant.js");
loader._load = originalLoad;

const token: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} })
};
const output = new NewsletterOutputManager();
const workflow = new NewsletterWorkflowRuntime(output);
registerNewsletterLanguageModelTools(workflow);

interface Status {
  workflowId: string;
  outputUri: string;
  proposalId?: string;
  status: string;
  saved: boolean;
  applyStatus: string;
  draftSections: readonly string[];
  community: { pendingBatch: boolean; completedBatches: number; remainingUrls: string[] };
}
function status(value: object): Status { return value as Status; }
async function invoke(name: string, input: object, invocationToken?: vscode.ChatParticipantToolToken,
  cancellation: vscode.CancellationToken = token): Promise<unknown> {
  const tool = tools.get(`aviators_${name}`);
  assert.ok(tool, name);
  const result = await tool.invoke({ input, toolInvocationToken: invocationToken }, cancellation);
  assert.ok(result);
  const part = result.content[0] as vscode.LanguageModelTextPart;
  return JSON.parse(part.value.slice(part.value.indexOf("{"))) as unknown;
}
async function begin(month: string, sections: ("aceAviator" | "productGroup" | "community")[] = ["aceAviator"]): Promise<Status> {
  return status(await workflow.begin({ month, sections }));
}
async function ace(id?: string, month = "November 2026"): Promise<unknown> {
  return invoke("createAceAviator", {
    month, name: "Fixture contributor",
    qaPairs: [{ question: "What helped you grow?", answer: "A supplied response." }],
    ...(id ? { workflowId: id } : {})
  });
}

function nativeFixtureTools(): void {
  mock.lm.tools = ["browser_navigate", "browser_snapshot"].map(name => ({ name, description: "", inputSchema: {} }));
}

async function reviewCancellation(): Promise<void> {
  for (const section of ["aceAviator", "community"] as const) {
    const selected = await begin(section === "community" ? "April 2027" : "May 2027", [section]);
    if (section === "community") {
      await workflow.execute("scrapeLinkedIn", {
        workflowId: selected.workflowId, urls: ["https://www.linkedin.com/in/cancel-fixture/"]
      }, async () => ({
        success: true, batchSize: 1, succeeded: 1, hasMore: false, remainingUrls: [],
        items: [{ url: "https://www.linkedin.com/in/cancel-fixture/", success: true, content: "Actual fixture" }]
      }));
    }
    let releaseRead: () => void = () => undefined;
    readBarrier = new Promise<void>(resolve => { releaseRead = resolve; });
    const started = new Promise<void>(resolve => { onReadStarted = resolve; });
    const cancellation = { isCancellationRequested: false, onCancellationRequested: token.onCancellationRequested };
    const input = section === "community"
      ? { workflowId: selected.workflowId, items: [{ externalLink: "https://contoso.com/canceled",
        title: "Canceled batch", authorName: "Actual contributor", summary: "Actual fixture" }] }
      : { workflowId: selected.workflowId, month: "May 2027", name: "Actual contributor",
        qaPairs: [{ question: "Role?", answer: "Supplied fixture" }] };
    const generating = invoke(section === "community" ? "createCommunityNews" : "createAceAviator",
      input, undefined, cancellation);
    await started;
    cancellation.isCancellationRequested = true;
    releaseRead();
    await assert.rejects(generating, error => error instanceof mock.CancellationError);
    readBarrier = undefined;
    onReadStarted = undefined;
    assert.equal(status(workflow.get(selected.workflowId)).proposalId, undefined,
      "cancellation during snapshot I/O must not commit any proposal");
    assert.equal(status(workflow.get(selected.workflowId)).status, "generating");
    assert.equal(status(workflow.get(selected.workflowId)).community.completedBatches, 0);
    assert.equal(files.has(selected.outputUri), false);
    await invoke(section === "community" ? "createCommunityNews" : "createAceAviator", input);
    assert.equal(status(workflow.get(selected.workflowId)).status, "staged", "canceled batch safely retries");
  }
  console.log("✓ Review regression: cancellation inside locked snapshot precedes proposal and Community generation commits");
}

async function reviewAllFailed(): Promise<void> {
  nativeFixtureTools();
  const selected = await begin("June 2027", ["community"]);
  const original = '<h1 id="communitynews">News from our community</h1><p>Keep existing Community</p>';
  files.set(selected.outputUri, original);
  nativeFails = true;
  const invocationToken = {} as vscode.ChatParticipantToolToken;
  const urls = ["https://www.linkedin.com/in/failed-fixture/"];
  await invoke("scrapeLinkedIn", { workflowId: selected.workflowId, urls }, invocationToken);
  await assert.rejects(invoke("createCommunityNews", { workflowId: selected.workflowId, items: [] }), /scrape failed/i);
  assert.equal(status(workflow.get(selected.workflowId)).proposalId, undefined);
  assert.equal(files.get(selected.outputUri), original);
  assert.deepEqual(status(workflow.get(selected.workflowId)).community.remainingUrls, urls);
  nativeFails = false;
  await invoke("scrapeLinkedIn", { workflowId: selected.workflowId, urls }, invocationToken);
  await invoke("createCommunityNews", { workflowId: selected.workflowId, items: [{
    externalLink: "https://contoso.com/recovered", title: "Recovered", authorName: "Actual contributor", summary: "Actual fixture"
  }] });
  assert.equal(status(workflow.get(selected.workflowId)).status, "staged");
  assert.equal(files.get(selected.outputUri), original, "recovery still stages, never auto-applies");
  console.log("✓ Review regression: registered all-failed scrape cannot erase existing Community; trusted URL retry recovers");
}

async function accumulatedDraftPersistence(): Promise<void> {
  const draftsOutput = new NewsletterOutputManager();
  const drafts = new NewsletterWorkflowRuntime(draftsOutput);
  registerNewsletterLanguageModelTools(drafts);
  const month = "January 2028";
  const product = status(await drafts.begin({ month, sections: ["productGroup"] }));
  const baseline = '<h1 id="aceaviator">Ace Aviator of the Month</h1><p>Existing Ace</p>' +
    '<h1 id="productnews">News from our product group</h1><p>Old product</p>' +
    '<h1 id="communitynews">News from our community</h1><p>Old Community</p>';
  files.set(product.outputUri, baseline);
  const stageProduct = (workflowId: string, title: string) => invoke("createProductGroupNews", {
    workflowId, month, posts: [{
      title, link: "https://contoso.com/accumulated-product", publishedAt: "2027-12-20",
      summary: "User-supplied product fixture."
    }]
  });
  await stageProduct(product.workflowId, "Accumulated product");
  await assert.rejects(drafts.begin({
    month: "February 2028", fileName: "January-2028.html", sections: ["aceAviator"]
  }), /pending draft for another month/);
  assert.equal(drafts.get(product.workflowId).status, "staged");
  const initialProposal = drafts.get(product.workflowId).proposalId!;
  const community = status(await drafts.begin({ month, sections: ["community"] }));
  assert.equal(drafts.get(community.workflowId).proposalId, initialProposal);
  assert.equal(draftsOutput.getProposalStatus(initialProposal).status, "pending",
    "beginning Community must not discard Product's pending draft");
  await assert.rejects(invoke("persistNewsletterDraft", { workflowId: product.workflowId }), /Complete the active workflow/);
  await assert.rejects(draftsOutput.applyProposal(initialProposal), /Complete the active workflow/);
  const urls = ["https://www.linkedin.com/in/draft-first/", "https://www.linkedin.com/in/draft-second/"];
  const scrape = (workflowId: string, remaining: string[], hasMore: boolean) =>
    drafts.execute("scrapeLinkedIn", { workflowId, urls: remaining }, async () => ({
      success: true, batchSize: 1, succeeded: 1, hasMore,
      remainingUrls: hasMore ? remaining.slice(1) : [],
      items: [{ url: remaining[0], success: true, content: "Actual fixture data" }]
    }));
  const stageCommunity = (workflowId: string, title: string, link: string) =>
    invoke("createCommunityNews", { workflowId, items: [{
      externalLink: link, title, authorName: "Fixture author", summary: "User supplied source fixture."
    }] });
  await scrape(community.workflowId, urls, true);
  await stageCommunity(community.workflowId, "Accumulated first", "https://contoso.com/first-draft");
  await assert.rejects(invoke("persistNewsletterDraft", {}), /Complete the active workflow/);
  await assert.rejects(drafts.begin({ month, sections: ["aceAviator"] }), /Complete the active workflow/);
  await scrape(community.workflowId, urls.slice(1), false);
  await stageCommunity(community.workflowId, "Accumulated second", "https://contoso.com/second-draft");
  const current = drafts.get(community.workflowId);
  assert.deepEqual(current.stagedSections, ["community"]);
  assert.deepEqual(current.draftSections, ["productGroup", "community"]);
  const draftText = draftsOutput.provideTextDocumentContent(Uri.from({
    scheme: "aviators-newsletter-proposal", authority: current.proposalId, path: "/proposed/January-2028.html"
  }) as vscode.Uri);
  for (const text of ["Existing Ace", "Accumulated product", "Accumulated first", "Accumulated second"])
    assert.ok(draftText.includes(text), text);
  assert.equal(files.get(product.outputUri), baseline, "all steps remain staged before explicit persistence");

  const persistTool = tools.get("aviators_persistNewsletterDraft")!;
  const confirmation = await persistTool.prepareInvocation?.({ input: {} }, token);
  assert.ok(confirmation?.confirmationMessages, "chat persistence requires explicit host confirmation");
  const canceled = { ...token, isCancellationRequested: true };
  await assert.rejects(invoke("persistNewsletterDraft", {}, undefined, canceled), error => error instanceof mock.CancellationError);
  assert.equal(files.get(product.outputUri), baseline);
  let releaseRead!: () => void;
  const started = new Promise<void>(resolve => { onReadStarted = resolve; });
  readBarrier = new Promise<void>(resolve => { releaseRead = resolve; });
  const midSaveCancellation = { ...token, isCancellationRequested: false };
  const cancelDuringRead = invoke("persistNewsletterDraft", { workflowId: product.workflowId }, undefined, midSaveCancellation);
  await started;
  midSaveCancellation.isCancellationRequested = true;
  releaseRead();
  try {
    await assert.rejects(cancelDuringRead, error => error instanceof mock.CancellationError);
  } finally {
    readBarrier = undefined;
    onReadStarted = undefined;
  }
  assert.equal(files.get(product.outputUri), baseline, "cancellation during asynchronous conflict checks must not apply edits");
  files.set(product.outputUri, baseline + "<p>External edit</p>");
  await assert.rejects(invoke("persistNewsletterDraft", { workflowId: product.workflowId }), /changed after this proposal/);
  assert.ok(files.get(product.outputUri)?.includes("External edit"), "accumulation retains the original conflict baseline");
  files.set(product.outputUri, baseline);
  const callsBefore = pickerCalls;
  const persisted = status(await invoke("persistNewsletterDraft", { workflowId: product.workflowId }) as object);
  assert.equal(persisted.workflowId, community.workflowId, "an older handle persists the current full target draft");
  assert.equal(persisted.saved, true);
  assert.equal(files.get(product.outputUri), draftText);
  assert.equal(pickerCalls, callsBefore, "explicit target must not select an unrelated draft");
  await assert.rejects(invoke("persistNewsletterDraft", { workflowId: product.workflowId }), /already applied/);

  const regenerate = status(await drafts.begin({ month, sections: ["productGroup"] }));
  await stageProduct(regenerate.workflowId, "Replacement product");
  const regenCommunity = status(await drafts.begin({ month, sections: ["community"] }));
  await scrape(regenCommunity.workflowId, urls.slice(1), false);
  await stageCommunity(regenCommunity.workflowId, "Replacement Community", "https://contoso.com/replacement-draft");
  const regeneratedProposal = drafts.get(regenCommunity.workflowId).proposalId!;
  assert.equal(await draftsOutput.selectProposal(), regeneratedProposal);
  await draftsOutput.applyProposal(regeneratedProposal);
  const replaced = files.get(product.outputUri)!;
  assert.ok(replaced.includes("Existing Ace") && replaced.includes("Replacement product") && replaced.includes("Replacement Community"));
  assert.ok(!replaced.includes("Accumulated product") && !replaced.includes("Accumulated first"),
    "regenerating a section replaces it, without duplicating prior batches");

  const aceDraft = status(await drafts.begin({ month: "February 2028", sections: ["aceAviator"] }));
  await ace(aceDraft.workflowId, "February 2028");
  const next = status(await drafts.begin({ month: "February 2028", sections: ["community"] }));
  await scrape(next.workflowId, urls.slice(1), false);
  await stageCommunity(next.workflowId, "Ace plus Community", "https://contoso.com/ace-community");
  const savedAce = status(await invoke("persistNewsletterDraft", {}) as object);
  assert.equal(savedAce.saved, true, "omitted target automatically resolves the only pending draft");
  assert.deepEqual(savedAce.draftSections, ["aceAviator", "community"]);
  assert.ok(files.get(next.outputUri)?.includes("Fixture contributor") && files.get(next.outputUri)?.includes("Ace plus Community"));

  const first = status(await drafts.begin({ month: "March 2028", sections: ["aceAviator"] }));
  await ace(first.workflowId, "March 2028");
  const second = status(await drafts.begin({ month: "April 2028", sections: ["aceAviator"] }));
  await ace(second.workflowId, "April 2028");
  pickFirst = false;
  const beforePicker = pickerCalls;
  await assert.rejects(invoke("persistNewsletterDraft", {}), error => error instanceof mock.CancellationError);
  assert.equal(pickerCalls, beforePicker + 1);
  assert.equal(files.has(first.outputUri), false);
  assert.equal(files.has(second.outputUri), false);
  pickFirst = true;
  const picked = status(await invoke("persistNewsletterDraft", {}) as object);
  assert.equal(picked.outputUri, first.outputUri, "multiple drafts require explicit target selection, not the newest");
  assert.equal(files.has(second.outputUri), false, "other newsletter targets stay pending");
  await assert.rejects(invoke("persistNewsletterDraft", { workflowId: "unknown" }), /Unknown workflow/);
  draftsOutput.discardProposal(drafts.get(second.workflowId).proposalId!);
  assert.equal(drafts.get(second.workflowId).status, "discarded");
  await assert.rejects(invoke("persistNewsletterDraft", { workflowId: second.workflowId }), /discarded/);
  await assert.rejects(invoke("persistNewsletterDraft", {}), /No pending newsletter drafts/);
  const fresh = status(await drafts.begin({ month: "April 2028", sections: ["community"] }));
  assert.equal(fresh.proposalId, undefined, "a discarded target starts a fresh draft");
  assert.deepEqual(fresh.draftSections, []);
  console.log("✓ Accumulated Product/Community and Ace/Community drafts persist from chat or palette; regeneration, incomplete guards, target selection and cancellation");
}

async function reviewLocal(): Promise<void> {
  nativeFixtureTools();
  let selected = await begin("July 2027", ["community"]);
  class TrackingOutput extends NewsletterOutputManager {
    notes = 0;
    interceptions = 0;
    session?: ReturnType<InstanceType<typeof NewsletterOutputManager>["createSession"]>;
    override createSession(...args: Parameters<InstanceType<typeof NewsletterOutputManager>["createSession"]>) {
      const session = super.createSession(...args);
      this.session = session;
      const note = session.noteToolInvocation.bind(session);
      session.noteToolInvocation = call => { this.notes++; note(call); };
      const intercept = session.handleToolResult.bind(session);
      session.handleToolResult = async (...values) => { this.interceptions++; return intercept(...values); };
      return session;
    }
  }
  async function localRound(managed: boolean, failed = false, final = false) {
    const localOutput = new TrackingOutput();
    const calls = [
      new mock.LanguageModelToolCallPart("scrape", "aviators_scrapeLinkedIn", {
        urls: final ? ["https://www.linkedin.com/in/local-first/"] :
          ["https://www.linkedin.com/in/local-first/", "https://www.linkedin.com/in/local-second/"],
        batchSize: 1, delayMs: 0, ...(managed ? { workflowId: selected.workflowId } : {})
      }),
      new mock.LanguageModelToolCallPart("generate", "aviators_createCommunityNews", {
        items: failed ? [] : [{ externalLink: "https://contoso.com/local", title: "Local actual result",
          authorName: "Actual contributor", summary: "Actual fixture" }],
        hasMore: !final, ...(managed ? { workflowId: selected.workflowId } : {})
      })
    ];
    let round = 0;
    const modelInputs: string[] = [];
    const model: vscode.LanguageModelChat = {
      name: "Fixture", id: "fixture", vendor: "fixture", family: "fixture", version: "1", maxInputTokens: 20000,
      async countTokens() { return 1; },
      async sendRequest(messages) {
        modelInputs.push(JSON.stringify(messages));
        const call = calls[round++];
        async function* stream() {
          if (call) yield call;
          else yield new mock.LanguageModelTextPart("Model's premature completion claim.");
        }
        async function* text() { yield ""; }
        return { stream: stream(), text: text() };
      }
    };
    const request: vscode.ChatRequest = {
      prompt: "Process the supplied Community fixture for July 2027.", command: undefined,
      references: [], toolReferences: [], toolInvocationToken: {} as vscode.ChatParticipantToolToken, model
    };
    const messages: string[] = [];
    const response: vscode.ChatResponseStream = {
      markdown(value) { messages.push(typeof value === "string" ? value : value.value); },
      anchor() {}, button() {}, filetree() {}, progress() {}, reference() {}, push() {}
    };
    const makeHandler: (manager: InstanceType<typeof NewsletterOutputManager>,
      runtime?: InstanceType<typeof NewsletterWorkflowRuntime>) => vscode.ChatRequestHandler = createNewsletterChatRequestHandler;
    nativeFails = failed;
    const result = await makeHandler(localOutput, workflow)(request, { history: [] }, response, token);
    nativeFails = false;
    assert.ok(result);
    return { result, messages, localOutput, modelInputs };
  }
  const managed = await localRound(true);
  assert.equal(managed.localOutput.notes, 0, "workflow-aware scrape must not create a Local generation");
  assert.equal(managed.localOutput.interceptions, 0, "managed Community must not enter legacy result parser");
  assert.equal(managed.localOutput.session?.hasPendingCommunity(), false);
  assert.equal(managed.result.metadata?.failedToolCalls, 0);
  assert.equal(managed.result.metadata?.status, "stopped", "trusted pending workflow cannot report completed");
  assert.ok(managed.modelInputs.some(input => input.includes("communityNewsBatch") && input.includes(selected.workflowId)),
    "full managed result and workflow status remain available to the Local model");
  assert.ok(managed.messages.some(message => message.includes(selected.workflowId)));
  const followups = new NewsletterChatFollowupProvider().provideFollowups(managed.result, { history: [] }, token);
  assert.ok(followups.some(followup => followup.prompt.includes(selected.workflowId)));
  const bare = await localRound(false);
  assert.equal(bare.localOutput.notes, 2);
  assert.equal(bare.localOutput.interceptions, 2);
  assert.equal(bare.localOutput.session?.hasPendingCommunity(), true);
  assert.equal(bare.result.metadata?.failedToolCalls, 0);
  assert.equal(bare.result.metadata?.status, "stopped");
  output.discardProposal(workflow.get(selected.workflowId).proposalId!);
  selected = await begin("July 2027", ["community"]);
  const final = await localRound(true, false, true);
  assert.equal(final.result.metadata?.status, "completed");
  assert.equal(final.result.metadata?.failedToolCalls, 0);
  assert.equal(final.localOutput.session?.hasPendingCommunity(), false);
  selected = await begin("July 2027", ["community"]);
  const failed = await localRound(true, true);
  assert.ok(failed.messages.some(message => /fixture source retrieval denied|scrape failed/i.test(message)),
    "wrapped full scrape failure must be explicitly surfaced");
  assert.ok((failed.result.metadata?.failedToolCalls ?? 0) > 0);
  assert.ok(failed.modelInputs.some(input => input.includes('\\"success\\": false') || input.includes('"success":false')),
    "full wrapped failure remains available to the model, not a success-shaped proxy");
  console.log("✓ Review regression: actual Local handler avoids managed re-staging/phantom generation, gates completion and preserves bare interception");
}

async function run(): Promise<void> {
  const probe = process.env.RUNTIME_REVIEW_PROBE;
  if (probe === "local") return reviewLocal();
  if (probe === "cancellation") return reviewCancellation();
  if (probe === "all-failed") return reviewAllFailed();
  const first = await begin("November 2026");
  assert.equal(files.size, 0);
  await ace();
  assert.equal(status(workflow.get(first.workflowId)).proposalId, undefined);
  await ace(first.workflowId);
  const staged = status(workflow.get(first.workflowId));
  assert.equal(staged.status, "staged");
  assert.ok(staged.proposalId);
  assert.equal(files.size, 0, "generation is a proposal, not a disk write");
  await invoke("reviewNewsletterWorkflow", { workflowId: first.workflowId });
  assert.ok(commandCalls.includes("vscode.diff"));
  assert.equal(await output.selectProposal(), staged.proposalId);
  pickFirst = false;
  assert.equal(await output.selectProposal(), undefined);
  pickFirst = true;
  await output.applyProposal(staged.proposalId);
  assert.equal(status(workflow.get(first.workflowId)).saved, true);
  assert.ok(files.get(first.outputUri)?.includes("Fixture contributor"));
  await invoke("openNewsletterPreview", { workflowId: first.workflowId });
  await assert.rejects(ace(first.workflowId), /already applied/);
  console.log("✓ Registered tools stage full results, preserve bare legacy calls, review/picker and explicit apply/save");

  const template = files.get(first.outputUri);
  await invoke("createNewsletterTemplate", { month: "November 2026" });
  assert.equal(files.get(first.outputUri), template, "template never overwrites");
  await assert.rejects(workflow.begin({ month: "invalid", sections: ["aceAviator"] }), /valid newsletter month/);
  for (const fileName of ["..\\escape.html", "CON.html", "other/file.html"]) {
    await assert.rejects(workflow.begin({ month: "November 2026", sections: ["aceAviator"], fileName }), /safe .html/);
  }
  await assert.rejects(workflow.begin({ month: "November 2026", sections: ["aceAviator"], workspaceFolder: "file:///elsewhere" }), /not an open/);
  folderSetting = "..\\unsafe";
  await assert.rejects(workflow.begin({ month: "November 2026", sections: ["aceAviator"] }), /path traversal/);
  folderSetting = "newsletters";
  await assert.rejects(workflow.preview("stale-after-reload"), /After extension reload/);
  console.log("✓ Template preservation and unsafe filename/workspace/folder/reload rejection");

  const dirty = await begin("November 2026");
  await ace(dirty.workflowId);
  const dirtyProposal = status(workflow.get(dirty.workflowId)).proposalId!;
  const document = documents.find(item => item.uri.toString() === dirty.outputUri)!;
  document.isDirty = true;
  await assert.rejects(output.applyProposal(dirtyProposal), /unsaved editor/);
  document.isDirty = false;
  files.set(dirty.outputUri, "external disk change");
  await assert.rejects(output.applyProposal(dirtyProposal), /changed after/);
  files.set(dirty.outputUri, template!);
  saveSucceeds = false;
  await assert.rejects(output.applyProposal(dirtyProposal), /applied to the editor but could not be saved/);
  assert.equal(status(workflow.get(dirty.workflowId)).applyStatus, "applied");
  assert.equal(status(workflow.get(dirty.workflowId)).saved, false);
  saveSucceeds = true;
  await document.save();
  console.log("✓ Dirty-editor/disk conflicts and truthful failed-save reporting");

  const community = await begin("December 2026", ["community"]);
  await assert.rejects(invoke("createCommunityNews", { workflowId: community.workflowId, items: [] }), /Scrape a Community/);
  await assert.rejects(invoke("scrapeLinkedIn", { workflowId: community.workflowId, urls: ["https://www.linkedin.com/in/person/"] }), /tool invocation token/);
  const urls = ["https://www.linkedin.com/in/first/", "https://www.linkedin.com/in/second/"];
  const fixture = async () => ({
    success: true, batchSize: 1, succeeded: 1, hasMore: true, remainingUrls: urls.slice(1),
    items: [{ url: urls[0], success: true, content: "Retrieved fixture data" }]
  });
  await workflow.execute("scrapeLinkedIn", { workflowId: community.workflowId, urls }, fixture);
  await assert.rejects(workflow.execute("scrapeLinkedIn",
    { workflowId: community.workflowId, urls: urls.slice(1) }, fixture), /prior Community/);
  await assert.rejects(invoke("createCommunityNews", {
    workflowId: community.workflowId, items: [], hasMore: false
  }), /conflicts with/);
  await invoke("createCommunityNews", { workflowId: community.workflowId, items: [{
    externalLink: "https://contoso.com/first", title: "First article", authorName: "Actual contributor",
    summary: "First batch"
  }] });
  const partial = status(workflow.get(community.workflowId));
  assert.equal(partial.status, "generating");
  await assert.rejects(output.applyProposal(partial.proposalId!), /Complete the active workflow/);
  await workflow.execute("scrapeLinkedIn", { workflowId: community.workflowId, urls: urls.slice(1) }, async () => ({
    success: true, batchSize: 1, succeeded: 1, hasMore: false, remainingUrls: [],
    items: [{ url: urls[1], success: true, content: "Second fixture" }]
  }));
  await invoke("createCommunityNews", { workflowId: community.workflowId, items: [{
    externalLink: "https://contoso.com/second", title: "Second article", authorName: "Actual contributor",
    summary: "Second batch"
  }] });
  const completed = status(workflow.get(community.workflowId));
  assert.equal(completed.status, "staged");
  const proposalText = output.provideTextDocumentContent(
    Uri.from({ scheme: "aviators-newsletter-proposal", authority: completed.proposalId, path: "/proposed/December-2026.html" }) as vscode.Uri
  );
  assert.ok(proposalText.includes("First article") && proposalText.includes("Second article"));
  const replacement = await begin("December 2026", ["community"]);
  assert.equal(status(workflow.get(community.workflowId)).status, "superseded");
  assert.equal(output.getProposalStatus(completed.proposalId!).status, "pending");
  await assert.rejects(invoke("createCommunityNews", { workflowId: community.workflowId, items: [] }), /superseded/);
  assert.equal(status(workflow.get(replacement.workflowId)).proposalId, completed.proposalId);
  console.log("✓ Trusted fixture continuation, batch accumulation, incomplete apply guard and superseded target rejection");

  const supplied = await begin("November 2026", ["productGroup", "aceAviator"]);
  const productInput = {
    workflowId: supplied.workflowId, month: "November 2026", posts: [{
      title: "Supplied product announcement", link: "https://contoso.com/product",
      publishedAt: "2026-10-20", summary: "User supplied product data."
    }]
  };
  await assert.rejects(invoke("createProductGroupNews", productInput), /next section is aceAviator/);
  await ace(supplied.workflowId);
  await invoke("createProductGroupNews", productInput);
  const suppliedStatus = status(workflow.get(supplied.workflowId));
  assert.equal(suppliedStatus.status, "staged");
  output.discardProposal(suppliedStatus.proposalId!);
  assert.equal(status(workflow.get(supplied.workflowId)).status, "discarded");
  await assert.rejects(ace(supplied.workflowId), /discarded/);
  console.log("✓ Supplied-data Ace/Product enforce host order without retrieval and discard invalidates generation");

  const networkFixture = await begin("January 2027", ["community"]);
  mock.lm.tools = ["browser_navigate", "browser_snapshot"].map(name => ({ name, description: "", inputSchema: {} }));
  const invocationToken = {} as vscode.ChatParticipantToolToken;
  await invoke("scrapeLinkedIn", {
    workflowId: networkFixture.workflowId, urls: ["https://www.linkedin.com/in/fixture/"], delayMs: 0
  }, invocationToken);
  assert.equal(forwardedTokens.length, 2);
  assert.ok(forwardedTokens.every(forwarded => forwarded === invocationToken));
  assert.equal(status(workflow.get(networkFixture.workflowId)).community.pendingBatch, true);
  await invoke("createCommunityNews", { workflowId: networkFixture.workflowId, items: [] });
  assert.equal(status(workflow.get(networkFixture.workflowId)).status, "staged");
  console.log("✓ Registered scrape stages actual progress with opaque nested token forwarding (mock only)");

  const concurrent = await begin("February 2027");
  await ace(concurrent.workflowId, "February 2027");
  const concurrentProposal = status(workflow.get(concurrent.workflowId)).proposalId!;
  let releaseSave: () => void = () => undefined;
  saveBarrier = new Promise<void>(resolve => { releaseSave = resolve; });
  const saveStarted = new Promise<void>(resolve => { onSaveStarted = resolve; });
  const applying = output.applyProposal(concurrentProposal);
  await saveStarted;
  assert.throws(() => output.discardProposal(concurrentProposal), /no longer pending/);
  const newWorkflow = begin("February 2027");
  await Promise.resolve();
  assert.equal(status(workflow.get(concurrent.workflowId)).status, "staged");
  releaseSave();
  await applying;
  await newWorkflow;
  assert.equal(status(workflow.get(concurrent.workflowId)).status, "superseded");
  assert.equal(status(workflow.get(concurrent.workflowId)).saved, true);
  saveBarrier = undefined;
  onSaveStarted = undefined;
  console.log("✓ Apply/save is serialized against superseding target workflows and concurrent discard is rejected");

  const caseTarget = await begin("March 2027");
  await workflow.begin({ month: "March 2027", sections: ["aceAviator"], fileName: "march-2027.html" });
  assert.equal(status(workflow.get(caseTarget.workflowId)).status, "superseded");

  const metadata = getAvailableLanguageModelChatTools();
  assert.equal(tools.size, 15);
  for (const name of ["createAceAviator", "createProductGroupNews", "createCommunityNews", "scrapeLinkedIn"]) {
    const schema = metadata.find(tool => tool.name === `aviators_${name}`)?.inputSchema as {
      properties: { workflowId: { type: string } }; required?: string[]
    };
    assert.equal(schema.properties.workflowId.type, "string");
    assert.ok(!schema.required?.includes("workflowId"));
  }
  console.log("✓ Six bounded operation registrations and four optional host workflow schemas");
  await reviewCancellation();
  await reviewAllFailed();
  await reviewLocal();
  await accumulatedDraftPersistence();
}

void run().catch(error => { console.error(error); process.exitCode = 1; });
