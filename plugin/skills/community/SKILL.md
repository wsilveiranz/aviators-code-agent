---
name: community
description: Explicitly stage Community news from real LinkedIn activity and linked pages, including trusted batch continuation.
argument-hint: "Month and LinkedIn activity URLs, or an existing workflowId to continue"
disable-model-invocation: true
---
# Community news

Invoke as `/aviators-newsletter:community`.

Read the [connected companion contract](../../references/workflow.md), [date-window helper](../../references/dateWindow.md), and [canonical Community procedure](../../references/communityNews.md). Replace its participant followup instruction with the same-handle status/continuation contract; no participant button or copied prior HTML is required.

Compute the date first, then begin with `sections: ["community"]` before retrieval, or inspect the user's existing `workflowId` and ensure prior selected sections are complete. On resume, inspect trusted pending data and remaining URLs before new scraping; never begin a new handle to continue an old generation.

Call `aviators.aviators-newsletter/scrapeLinkedIn` with the same `workflowId` for every batch, default size three. Use only actual returned authors and links. Resolve redirects if needed with `aviators.aviators-newsletter/resolveRedirects`; read each linked source with `aviators.aviators-newsletter/playwright_navigate` for factual 80–100 word summaries.

Call `aviators.aviators-newsletter/createCommunityNews` with the same `workflowId`, only the current processed items, and accurate `hasMore`. Inspect trusted status and continue until no remaining URLs or pending batch exist. Report all skipped/failed URLs and reasons; never invent scraped data or treat an incomplete generation as finished. Open review for staged output; applying remains a user action.
