import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COMMUNITY_SECTION_HEADING,
  communityNewsSkill,
  findCommunityNewsBatchResult,
  filterValidItems,
  generateItemHTML,
  mergeCommunitySection,
  type CommunityBatchItem,
  type CommunityItem,
  type CommunityNewsParams,
} from '../src/core/communityNews.js';
import { SKILL_PROMPTS } from '../src/core/skillPrompts.js';
import {
  TOOL_RESULT_TRUNCATION_MARKER,
  truncateSerializedToolResult,
} from '../src/extension/toolResult.js';
import {
  CommunityGenerationCoordinator,
  CommunityGenerationRun,
  readCommunityResumeMetadata,
} from '../src/extension/communityGeneration.js';
import { sampleLinkedInPosts } from './sampleData.js';

type TestFunction = () => void | Promise<void>;

async function test(name: string, fn: TestFunction): Promise<boolean> {
  try {
    await fn();
    console.log(`✓ ${name}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`✗ ${name}`);
    console.log(`  Error: ${message}`);
    return false;
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${String(expected)}", got "${String(actual)}"`);
  }
}

function assertTrue(actual: unknown, message: string): asserts actual {
  if (!actual) {
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertArrayLength<T>(array: T[], expected: number, message: string): void {
  if (array.length !== expected) {
    throw new Error(`${message}: expected ${expected} items, got ${array.length}`);
  }
}

function toCommunityItems(): CommunityItem[] {
  return sampleLinkedInPosts.posts.map((post) => ({
    externalLink: post.linkedArticle?.url ?? post.url,
    title: post.linkedArticle?.title ?? `Post by ${post.author}`,
    authorProfile: post.authorUrl,
    authorName: post.author,
    summary: post.content,
  }));
}

console.log('\n=== Community News Tests ===\n');

let passed = 0;
let failed = 0;
const items = toCommunityItems();

async function runTests(): Promise<void> {
if (await test('Should transform sample LinkedIn posts to community items', () => {
  assertArrayLength(items, 3, 'Community items');
  assertEqual(items[0].title, 'Azure Integrations That Actually Work in Production', 'Article title');
})) passed += 1; else failed += 1;

if (await test('Should use article URL when available', () => {
  assertEqual(
    items[0].externalLink,
    'https://www.linkedin.com/pulse/azure-integrations-actually-work-production-devarajan-gurusamy',
    'External link',
  );
})) passed += 1; else failed += 1;

if (await test('Should fall back to the LinkedIn post URL', () => {
  assertEqual(
    items[2].externalLink,
    'https://www.linkedin.com/feed/update/urn:li:activity:7419768336500150273/',
    'Fallback link',
  );
})) passed += 1; else failed += 1;

if (await test('Should filter invalid and duplicate items', () => {
  const valid = filterValidItems([
    ...items,
    items[0],
    { title: 'Missing URL' },
    { externalLink: 'javascript:alert(1)', title: 'Unsafe URL' },
    { externalLink: 'http-not-a-url', title: 'Malformed URL' },
  ]);
  assertArrayLength(valid, 3, 'Valid unique items');
})) passed += 1; else failed += 1;

if (await test('Should generate valid item HTML', () => {
  const html = generateItemHTML(items[0]);
  assertTrue(html.includes('<h5>'), 'Should have h5 tag');
  assertTrue(html.includes('Devarajan Gurusamy'), 'Should have author name');
  assertTrue(html.includes('target="_blank"'), 'Should have target blank');
})) passed += 1; else failed += 1;

if (await test('Should escape community content and URL attributes', () => {
  const html = generateItemHTML({
    externalLink: 'https://example.com/article?a=1&b=2',
    title: '<img src=x onerror=alert(1)>',
    authorProfile: 'https://example.com/author?a=1&b=2',
    authorName: 'Author <Admin>',
    summary: '<script>alert(1)</script>',
    itemKind: 'Post <unsafe>',
  });

  assertTrue(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'Title should be escaped');
  assertTrue(html.includes('article?a=1&amp;b=2'), 'Article URL attribute should be escaped');
  assertTrue(html.includes('Author &lt;Admin&gt;'), 'Author should be escaped');
  assertTrue(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Summary should be escaped');
  assertTrue(!html.includes('<script>'), 'Should not include executable script markup');
})) passed += 1; else failed += 1;

if (await test('Should safely fall back when community URLs are invalid', () => {
  const html = generateItemHTML({
    externalLink: 'javascript:alert(1)',
    title: 'Unsafe Article',
    authorProfile: 'data:text/html,unsafe',
    authorName: 'Unsafe Author',
    summary: 'Summary',
  });

  assertTrue(html.includes('<h5>Unsafe Article</h5>'), 'Should retain the escaped title');
  assertTrue(html.includes('<em>Unsafe Author</em>'), 'Should retain the escaped author');
  assertTrue(!html.includes('href='), 'Invalid links should not render anchors');
})) passed += 1; else failed += 1;

const firstBatch: CommunityBatchItem[] = [
  {
    externalLink: 'https://example.com/article1',
    title: 'Article One',
    authorProfile: 'https://linkedin.com/in/author1',
    authorName: 'Author One',
    summary: 'Summary of article one.',
    itemKind: 'Post',
  },
  {
    externalLink: 'https://example.com/article2',
    title: 'Article Two',
    authorProfile: 'https://linkedin.com/in/author2',
    authorName: 'Author Two',
    summary: 'Summary of article two.',
    itemKind: 'Video',
  },
];

const secondBatch: CommunityBatchItem[] = [
  {
    externalLink: 'https://example.com/article3',
    title: 'Article Three',
    authorProfile: 'https://linkedin.com/in/author3',
    authorName: 'Author Three',
    summary: 'Summary of article three.',
    itemKind: 'Post',
  },
];

const finalBatch: CommunityBatchItem[] = [
  {
    externalLink: 'https://example.com/article4',
    title: 'Article Four',
    authorProfile: 'https://linkedin.com/in/author4',
    authorName: 'Author Four',
    summary: 'Summary of article four.',
    itemKind: 'Post',
  },
];

if (await test('Each invocation returns only the new escaped batch', async () => {
  const result = await communityNewsSkill.execute({
    items: firstBatch,
    hasMore: true,
  });
  assertTrue(result.success, 'Should succeed');
  assertEqual(result.kind, 'communityNewsBatch', 'Structured result kind');
  assertEqual(result.hasMore, true, 'Should preserve hasMore');
  assertEqual(result.isFinalBatch, false, 'Should identify an intermediate batch');
  assertTrue(!result.batchHtml.includes('communitynews'), 'Batch should not contain the section heading');
  assertTrue(result.batchHtml.includes('Article One'), 'Batch should contain its own items');
  assertEqual(result.validItems, 2, 'Valid item count');
  assertTrue(!('generation' in result), 'Direct tool results should not expose generation state');
})) passed += 1; else failed += 1;

if (await test('Trusted output merge preserves first, intermediate, and final batches', async () => {
  const first = await communityNewsSkill.execute({
    items: firstBatch,
    hasMore: true,
  });
  assertTrue(first.success, 'First batch should succeed');
  const intermediate = await communityNewsSkill.execute({
    items: secondBatch,
    hasMore: true,
  });
  assertTrue(intermediate.success, 'Intermediate batch should succeed');
  const final = await communityNewsSkill.execute({
    items: finalBatch,
    hasMore: false,
  });
  assertTrue(final.success, 'Final batch should succeed');

  let persisted =
    `${COMMUNITY_SECTION_HEADING}\n` +
    '<p><em>&lt;TODO: Generate Community section&gt;</em></p>';
  persisted = mergeCommunitySection(persisted, first.items);
  persisted = mergeCommunitySection(persisted, intermediate.items);

  // An explicit continuation appends the final batch.
  persisted = mergeCommunitySection(persisted, final.items);

  assertEqual(
    (persisted.match(/<h1 id="communitynews">/g) ?? []).length,
    1,
    'Section header count',
  );
  assertTrue(persisted.includes('Article One'), 'Should preserve the first batch');
  assertTrue(persisted.includes('Article Three'), 'Should preserve the intermediate batch');
  assertTrue(persisted.includes('Article Four'), 'Should include the final batch');
  assertTrue(!persisted.includes('&lt;TODO:'), 'Should remove the template placeholder');
  assertEqual(first.hasMore, true, 'First batch should indicate continuation');
  assertEqual(intermediate.isFinalBatch, false, 'Intermediate batch should not be final');
  assertEqual(final.isFinalBatch, true, 'Final batch should be final');
})) passed += 1; else failed += 1;

if (await test('Fresh Community generations replace stale output before appending continuations', () => {
  const target = 'newsletter:February-2026';
  const coordinator = new CommunityGenerationCoordinator();
  let persisted =
    `${COMMUNITY_SECTION_HEADING}\n` +
    generateItemHTML({
      externalLink: 'https://example.com/stale',
      title: 'Stale Article',
      authorName: 'Stale Author',
      summary: 'Stale summary.',
      itemKind: 'Post',
    });

  const persistBatch = (
    run: CommunityGenerationRun,
    batchItems: typeof firstBatch,
  ): void => {
    const write = run.prepareBatch(target);
    const prepared = coordinator.prepareBatch(target, write, batchItems);
    persisted = prepared.html;
    coordinator.commitBatch(target, write, prepared);
    run.markBatchPersisted(target, write);
  };

  const firstRun = new CommunityGenerationRun();
  persistBatch(firstRun, firstBatch);
  assertTrue(!persisted.includes('Stale Article'), 'First batch should replace stale output');
  assertTrue(persisted.includes('Article One'), 'First batch should be persisted');

  persistBatch(firstRun, [firstBatch[0], ...secondBatch]);
  assertTrue(persisted.includes('Article One'), 'Continuation should retain the first batch');
  assertTrue(persisted.includes('Article Three'), 'Continuation should append the next batch');
  assertEqual(
    (persisted.match(/Article One/g) ?? []).length,
    1,
    'Duplicate item count',
  );

  const retryRun = new CommunityGenerationRun();
  persistBatch(retryRun, finalBatch);
  assertTrue(!persisted.includes('Article One'), 'A new run should replace the prior run');
  assertTrue(!persisted.includes('Article Three'), 'A retry should not append to stale batches');
  assertTrue(persisted.includes('Article Four'), 'A new run should persist its first batch');
  let staleContinuationRejected = false;
  try {
    coordinator.prepareBatch(
      target,
      firstRun.prepareBatch(target),
      secondBatch,
    );
  } catch {
    staleContinuationRejected = true;
  }
  assertTrue(
    staleContinuationRejected,
    'A cancelled or superseded run should not append after a retry',
  );
  assertTrue(persisted.includes('Article Four'), 'Rejected continuation should not change output');
  assertEqual(
    (persisted.match(/<h1 id="communitynews">/g) ?? []).length,
    1,
    'Section header count',
  );
})) passed += 1; else failed += 1;

if (await test('Discarding a Community proposal invalidates its resume state', () => {
  const target = 'newsletter:discarded';
  const coordinator = new CommunityGenerationCoordinator();
  const run = coordinator.startGeneration();
  coordinator.recordScrapeStarted(run.generationId, {
    urls: ['https://linkedin.com/in/example'],
  });
  coordinator.recordScrapeResult(run.generationId, {
    success: true,
    hasMore: true,
    remainingUrls: ['https://linkedin.com/in/example'],
  });
  const write = run.prepareBatch(target);
  const prepared = coordinator.prepareBatch(target, write, firstBatch);
  coordinator.commitBatch(target, write, prepared, { hasMore: true });
  run.markBatchPersisted(target, write);

  assertTrue(
    coordinator.getResumeMetadata(run.generationId),
    'Pending generation should initially be resumable',
  );
  coordinator.abandonGeneration(run.generationId);
  assertEqual(
    coordinator.getResumeMetadata(run.generationId),
    undefined,
    'Discarded generation resume metadata',
  );
  assertEqual(
    coordinator.hasPendingGeneration(run.generationId),
    false,
    'Discarded generation pending state',
  );
})) passed += 1; else failed += 1;

if (await test('Cross-request Community resume appends the first resumed batch', () => {
  const target = 'newsletter:cross-request-resume';
  const coordinator = new CommunityGenerationCoordinator();
  const firstRun = coordinator.startGeneration();
  const allUrls = [
    'https://www.linkedin.com/feed/update/urn:li:activity:first/',
    'https://www.linkedin.com/feed/update/urn:li:activity:second/',
  ];
  const remainingUrls = [allUrls[1]];

  coordinator.recordScrapeStarted(firstRun.generationId, {
    urls: allUrls,
  });
  coordinator.recordScrapeResult(firstRun.generationId, [{
    value: `Scrape LinkedIn Activity result:\n${JSON.stringify({
      success: true,
      hasMore: true,
      remainingUrls,
    })}`,
  }]);

  const firstWrite = firstRun.prepareBatch(target);
  const firstPrepared = coordinator.prepareBatch(
    target,
    firstWrite,
    firstBatch,
  );
  coordinator.commitBatch(
    target,
    firstWrite,
    firstPrepared,
    { hasMore: true },
  );
  firstRun.markBatchPersisted(target, firstWrite);

  const metadata = coordinator.getResumeMetadata(firstRun.generationId);
  assertTrue(metadata, 'Pending generation should produce resume metadata');
  const serialized = JSON.stringify(metadata);
  assertTrue(!serialized.includes('Article One'), 'Metadata must not contain newsletter HTML or item content');

  const restoredMetadata = JSON.parse(serialized) as unknown;
  const resumedRun = coordinator.resumeGeneration(restoredMetadata);
  assertTrue(resumedRun, 'Trusted serialized metadata should resume');
  coordinator.recordScrapeStarted(resumedRun.generationId, {
    urls: remainingUrls,
  });
  coordinator.recordScrapeResult(resumedRun.generationId, {
    success: true,
    hasMore: false,
    remainingUrls: [],
  });

  const resumedWrite = resumedRun.prepareBatch(target);
  assertEqual(resumedWrite.continuation, true, 'First resumed batch should append');
  const resumedPrepared = coordinator.prepareBatch(
    target,
    resumedWrite,
    secondBatch,
  );
  assertTrue(resumedPrepared.html.includes('Article One'), 'Resume should retain the prior batch');
  assertTrue(resumedPrepared.html.includes('Article Three'), 'Resume should add the new batch');
  coordinator.commitBatch(
    target,
    resumedWrite,
    resumedPrepared,
    { hasMore: false },
  );
  resumedRun.markBatchPersisted(target, resumedWrite);

  assertEqual(
    coordinator.hasPendingGeneration(resumedRun.generationId),
    false,
    'Final hasMore=false batch should complete Community',
  );
  assertEqual(
    coordinator.getResumeMetadata(resumedRun.generationId),
    undefined,
    'Completed Community should not offer resume metadata',
  );
})) passed += 1; else failed += 1;

if (await test('Community completion stays gated while hasMore is true', () => {
  const target = 'newsletter:completion-gating';
  const coordinator = new CommunityGenerationCoordinator();
  const run = coordinator.startGeneration();
  coordinator.recordScrapeStarted(run.generationId, {
    urls: [
      'https://www.linkedin.com/feed/update/urn:li:activity:first/',
      'https://www.linkedin.com/feed/update/urn:li:activity:second/',
    ],
  });
  coordinator.recordScrapeResult(run.generationId, {
    success: true,
    hasMore: true,
    remainingUrls: [
      'https://www.linkedin.com/feed/update/urn:li:activity:second/',
    ],
  });

  const write = run.prepareBatch(target);
  const prepared = coordinator.prepareBatch(target, write, firstBatch);
  coordinator.commitBatch(target, write, prepared, { hasMore: true });
  run.markBatchPersisted(target, write);

  assertEqual(
    coordinator.hasPendingGeneration(run.generationId),
    true,
    'hasMore=true must remain pending',
  );
  assertTrue(
    coordinator.getResumeMetadata(run.generationId),
    'Pending generation should retain a safe cursor',
  );
})) passed += 1; else failed += 1;

if (await test('A new explicit generation replaces stale partial Community output', () => {
  const target = 'newsletter:explicit-command';
  const coordinator = new CommunityGenerationCoordinator();
  const staleRun = coordinator.startGeneration();
  const staleWrite = staleRun.prepareBatch(target);
  const stalePrepared = coordinator.prepareBatch(
    target,
    staleWrite,
    firstBatch,
  );
  coordinator.commitBatch(
    target,
    staleWrite,
    stalePrepared,
    { hasMore: true },
  );
  staleRun.markBatchPersisted(target, staleWrite);

  const explicitRun = coordinator.startGeneration();
  const replacementWrite = explicitRun.prepareBatch(target);
  assertEqual(
    replacementWrite.continuation,
    false,
    'An explicit command must start a fresh generation',
  );
  const replacement = coordinator.prepareBatch(
    target,
    replacementWrite,
    finalBatch,
  );
  assertTrue(!replacement.html.includes('Article One'), 'Fresh generation should not append stale items');
  assertTrue(replacement.html.includes('Article Four'), 'Fresh generation should contain its own batch');
  coordinator.commitBatch(
    target,
    replacementWrite,
    replacement,
    { hasMore: false },
  );
  explicitRun.markBatchPersisted(target, replacementWrite);
})) passed += 1; else failed += 1;

if (await test('Invalid or stale Community metadata is rejected and safely starts fresh', () => {
  const target = 'newsletter:invalid-metadata';
  const coordinator = new CommunityGenerationCoordinator();
  const run = coordinator.startGeneration();
  coordinator.recordScrapeStarted(run.generationId, {
    urls: [
      'https://www.linkedin.com/feed/update/urn:li:activity:first/',
      'https://www.linkedin.com/feed/update/urn:li:activity:second/',
    ],
  });
  coordinator.recordScrapeResult(run.generationId, {
    success: true,
    hasMore: true,
    remainingUrls: [
      'https://www.linkedin.com/feed/update/urn:li:activity:second/',
    ],
  });
  const write = run.prepareBatch(target);
  const prepared = coordinator.prepareBatch(target, write, firstBatch);
  coordinator.commitBatch(target, write, prepared, { hasMore: true });
  run.markBatchPersisted(target, write);

  const trusted = coordinator.getResumeMetadata(run.generationId);
  assertTrue(trusted, 'Should have trusted metadata to tamper with');
  const forged = {
    ...trusted,
    cursor: {
      ...trusted.cursor,
      urls: ['https://attacker.example/forged'],
    },
  };
  assertEqual(
    coordinator.resumeGeneration(forged),
    undefined,
    'Forged cursor must not resume an active generation',
  );
  assertEqual(
    readCommunityResumeMetadata({
      ...trusted,
      newsletterHtml: '<h1 id="communitynews">forged</h1>',
    }),
    undefined,
    'Metadata with unexpected HTML state must be rejected',
  );

  const freshRun = coordinator.startGeneration();
  const freshWrite = freshRun.prepareBatch(target);
  assertEqual(freshWrite.continuation, false, 'Rejected metadata should fall back to a fresh run');
  const freshPrepared = coordinator.prepareBatch(
    target,
    freshWrite,
    finalBatch,
  );
  assertTrue(!freshPrepared.html.includes('Article One'), 'Fresh fallback must replace partial output');
  assertTrue(freshPrepared.html.includes('Article Four'), 'Fresh fallback should retain the new batch');
  coordinator.commitBatch(
    target,
    freshWrite,
    freshPrepared,
    { hasMore: false },
  );
  freshRun.markBatchPersisted(target, freshWrite);
  assertEqual(
    coordinator.resumeGeneration(trusted),
    undefined,
    'Metadata for a superseded generation must become stale',
  );
})) passed += 1; else failed += 1;

if (await test('Malicious existingHtml input is rejected and never returned', async () => {
  const maliciousHtml =
    `${COMMUNITY_SECTION_HEADING}<script>globalThis.compromised = true</script>`;
  const rejected = await communityNewsSkill.execute({
    items: secondBatch,
    existingHtml: maliciousHtml,
  } as unknown as CommunityNewsParams);
  assertTrue(rejected.success === false, 'Should reject prior HTML state');
  assertTrue(rejected.error.includes('not accepted'), 'Should explain that prior HTML is unsupported');
  assertTrue(
    !JSON.stringify(rejected).includes(maliciousHtml),
    'Should not echo attacker-controlled HTML',
  );
})) passed += 1; else failed += 1;

if (await test('Fabricated Community data is still rejected without replacing output', async () => {
  const rejected = await communityNewsSkill.execute({
    items: [{
      externalLink: 'https://example.com/fake',
      title: 'Fake',
      authorName: 'John Doe',
      summary: 'Fake',
    }],
  });
  assertTrue(rejected.success === false, 'Should reject fabricated data');
  assertTrue(!('batchHtml' in rejected), 'Failure should not return replaceable HTML');
})) passed += 1; else failed += 1;

if (await test('Output merge ignores arbitrary batch markup and escapes structured fields', async () => {
  const result = await communityNewsSkill.execute({
    items: [{
      externalLink: 'https://example.com/safe',
      title: '<img src=x onerror=alert(1)>',
      authorName: 'Safe Author',
      summary: '<script>alert(1)</script>',
      itemKind: 'Post',
    }],
  });
  assertTrue(result.success, 'Batch should succeed');

  const parsed = findCommunityNewsBatchResult([{
    value: `Create Community News result:\n${JSON.stringify({
      ...result,
      batchHtml: '<script>attackerControlled()</script>',
    })}`,
  }]);
  assertTrue(parsed, 'Structured batch should be found');
  const persisted = mergeCommunitySection(COMMUNITY_SECTION_HEADING, parsed.items);
  assertTrue(!persisted.includes('attackerControlled'), 'Should ignore supplied batch markup');
  assertTrue(!persisted.includes('<script>'), 'Should not persist executable markup');
  assertTrue(
    persisted.includes('&lt;img src=x onerror=alert(1)&gt;'),
    'Should escape structured item fields',
  );
})) passed += 1; else failed += 1;

if (await test('Model-visible truncation cannot control persisted Community state', async () => {
  const sentinel = '<persisted-only-content>';
  const result = await communityNewsSkill.execute({
    items: [{
      externalLink: 'https://example.com/large',
      title: 'Large result',
      authorName: 'Trusted Author',
      summary: `${'A'.repeat(4000)}${sentinel}${'B'.repeat(4000)}`,
      itemKind: 'Post',
    }],
  });
  assertTrue(result.success, 'Large batch should succeed');

  const fullToolContent = [{
    value: `Create Community News result:\n${JSON.stringify(result)}`,
  }];
  const trustedBatch = findCommunityNewsBatchResult(fullToolContent);
  assertTrue(trustedBatch, 'Full result should provide the persisted batch');
  const persisted = mergeCommunitySection(
    COMMUNITY_SECTION_HEADING,
    trustedBatch.items,
  );

  const modelVisible = truncateSerializedToolResult(
    JSON.stringify(fullToolContent),
    0,
  );
  assertEqual(
    modelVisible,
    TOOL_RESULT_TRUNCATION_MARKER,
    'Model should see only the truncation marker',
  );
  assertTrue(
    persisted.includes('&lt;persisted-only-content&gt;'),
    'Persisted output should retain content from the full pre-truncation result',
  );
})) passed += 1; else failed += 1;

if (await test('Community schemas and prompt reject prior HTML state', () => {
  const coreProperties = communityNewsSkill.parameters.properties ?? {};
  assertTrue(!('existingHtml' in coreProperties), 'Core schema should not expose existingHtml');
  assertTrue(!('generation' in coreProperties), 'Core schema should not expose generation state');
  assertTrue(!('runId' in coreProperties), 'Core schema should not expose a run identifier');
  assertEqual(
    communityNewsSkill.parameters.additionalProperties,
    false,
    'Core schema should reject unknown properties',
  );
  assertTrue(
    !SKILL_PROMPTS.communityNews.includes('existingHtml'),
    'Skill prompt should not mention existingHtml',
  );

  const manifest = JSON.parse(
    readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
  ) as {
    contributes: {
      languageModelTools: Array<{
        name: string;
        modelDescription: string;
        inputSchema: {
          additionalProperties?: boolean;
          properties?: Record<string, unknown>;
        };
      }>;
    };
  };
  const tool = manifest.contributes.languageModelTools.find(
    candidate => candidate.name === 'aviators_createCommunityNews',
  );
  assertTrue(tool, 'Manifest Community tool should exist');
  assertTrue(
    !('existingHtml' in (tool.inputSchema.properties ?? {})),
    'Manifest schema should not expose existingHtml',
  );
  assertTrue(
    !('generation' in (tool.inputSchema.properties ?? {})),
    'Manifest schema should not expose generation state',
  );
  assertTrue(
    !('runId' in (tool.inputSchema.properties ?? {})),
    'Manifest schema should not expose a run identifier',
  );
  assertEqual(
    tool.inputSchema.additionalProperties,
    false,
    'Manifest schema should reject unknown properties',
  );
  assertTrue(
    !tool.modelDescription.includes('existingHtml'),
    'Manifest description should not instruct model-controlled append state',
  );
})) passed += 1; else failed += 1;

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) process.exitCode = 1;
}

void runTests();
