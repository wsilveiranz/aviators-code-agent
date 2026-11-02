import { strict as assert } from "node:assert";
import { NewsletterWorkflowCoordinator } from "../src/core/newsletterWorkflow.js";

const coordinator = new NewsletterWorkflowCoordinator();
const first = coordinator.begin("November 2026", "file:///workspace/November.html",
  ["community", "aceAviator", "productGroup"]);
assert.deepEqual(first.sections, ["aceAviator", "productGroup", "community"]);
assert.throws(() => coordinator.assertNext(first.workflowId, "community"), /next section/);
coordinator.staged(first.workflowId, "aceAviator");
coordinator.staged(first.workflowId, "productGroup");
const urls = ["https://www.linkedin.com/in/real-one/recent-activity/",
  "https://www.linkedin.com/in/real-two/recent-activity/"];
coordinator.startScrape(first.workflowId, urls);
assert.throws(() => coordinator.startScrape(first.workflowId, urls), /prior Community/);
coordinator.finishScrape(first.workflowId, {
  success: true, batchSize: 1, succeeded: 1, hasMore: true, remainingUrls: urls.slice(1),
  items: [{ url: urls[0], success: true, content: "actual content" }]
});
assert.equal(coordinator.communityProgress(first.workflowId, 1), true);
assert.throws(() => coordinator.startScrape(first.workflowId, urls.slice(1)), /prior Community/);
coordinator.staged(first.workflowId, "community");
assert.equal(coordinator.get(first.workflowId).status, "generating");
assert.deepEqual(coordinator.get(first.workflowId).stagedSections, ["aceAviator", "productGroup", "community"]);
assert.throws(() => coordinator.startScrape(first.workflowId, urls), /trusted remaining/);
coordinator.startScrape(first.workflowId, urls.slice(1));
assert.throws(() => coordinator.finishScrape(first.workflowId, {
  success: true, batchSize: 1, succeeded: 1, hasMore: true, remainingUrls: urls,
  items: [{ url: urls[1], success: true }]
}), /invalid trusted/);
coordinator.startScrape(first.workflowId, urls.slice(1));
coordinator.finishScrape(first.workflowId, {
  success: false, batchSize: 1, succeeded: 0, hasMore: false, remainingUrls: [],
  items: [{ url: urls[1], success: false, error: "denied" }]
});
assert.throws(() => coordinator.communityProgress(first.workflowId, 1), /scrape failed/);
assert.throws(() => coordinator.communityProgress(first.workflowId, 0), /scrape failed/);
assert.throws(() => coordinator.startScrape(first.workflowId, urls), /trusted remaining/);
coordinator.startScrape(first.workflowId, urls.slice(1));
coordinator.finishScrape(first.workflowId, {
  success: true, batchSize: 1, succeeded: 1, hasMore: false, remainingUrls: [],
  items: [{ url: urls[1], success: true, content: "Recovered" }]
});
assert.equal(coordinator.communityProgress(first.workflowId, 0), false);
coordinator.staged(first.workflowId, "community");
assert.equal(coordinator.get(first.workflowId).status, "staged");
assert.equal(coordinator.get(first.workflowId).community.skippedUrls.length, 1);
assert.throws(() => coordinator.startScrape(first.workflowId, urls), /staged/);

const other = coordinator.begin("December 2026", "file:///other/December.html", ["aceAviator"]);
coordinator.begin("November 2026", first.outputUri, ["community"]);
assert.equal(coordinator.get(first.workflowId).status, "superseded");
assert.equal(coordinator.get(other.workflowId).status, "generating");
assert.throws(() => coordinator.assertNext(first.workflowId, "community"), /superseded/);
assert.throws(() => coordinator.get("reloaded-handle"), /After extension reload/);
assert.throws(() => coordinator.begin("November 2026", "invalid", ["community", "community"]), /unique/);
console.log("✓ Newsletter workflow order, trusted cursor, pending/failure, supersession and reload transitions");
