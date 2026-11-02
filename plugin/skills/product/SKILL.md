---
name: product
description: Explicitly stage Product Group news from actually read posts in the newsletter date window.
argument-hint: "Month; optional supplied post URLs, authorized date exception, and workflowId"
disable-model-invocation: true
---
# Product Group news

Invoke as `/aviators-newsletter:product`.

Read the [connected companion contract](../../references/workflow.md), [date-window helper](../../references/dateWindow.md), and [canonical Product procedure](../../references/productGroup.md).

Compute the date first, then begin with `sections: ["productGroup"]` before source retrieval, or inspect the user's existing `workflowId` and wait until any selected Ace step is complete. Use `aviators.aviators-newsletter/getTechCommunityBlogPosts` for the computed range and `aviators.aviators-newsletter/playwright_navigate` to read each included article. Preserve source publication dates, Logic Apps relevance, newsletter exclusion, and actual-content 80–120 word summaries.

Only an explicit user instruction permits supplied out-of-window posts via `includeOutsideDateWindow: true` and `dateWindowOverrideReason`; never infer an exception. Report unreadable/skipped sources and empty results honestly.

Call `aviators.aviators-newsletter/createProductGroupNews` with the same `workflowId` and gathered posts; inspect staged status and open review. Do not start Community merely because a shared procedure mentions it.
