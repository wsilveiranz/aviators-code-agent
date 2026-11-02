---
name: ace
description: Explicitly stage an Ace Aviator interview from supplied genuine Q&A or approved source email.
argument-hint: "Month; name; supplied Q&A or email subject; optional LinkedIn URL and workflowId"
disable-model-invocation: true
---
# Ace Aviator

Invoke as `/aviators-newsletter:ace`.

Read the [connected companion contract](../../references/workflow.md), [date-window helper](../../references/dateWindow.md), and [canonical interview procedure](../../references/aceAviator.md). The companion contract takes precedence over illustrative unbound tool calls.

Compute the date first, then begin with `sections: ["aceAviator"]` before retrieval/generation, or inspect and continue the user's existing `workflowId` at its allowed Ace step. Use supplied real Q&A/email directly when available; call `aviators.aviators-newsletter/getEmailFromMCP` only when the user requests inbox retrieval. Extract answers from the response, not the quoted invitation, signatures, or footers; never fill missing answers yourself.

Call `aviators.aviators-newsletter/createAceAviator` with the same `workflowId` and parsed `qaPairs`. Inspect trusted staged status and open review, not a direct write. Stop after Ace unless the existing explicitly selected workflow and user instruction authorize subsequent sections.

Synthetic Q&A is permitted only as an explicitly user-supplied test fixture and must be identified as synthetic, never presented as a real interview.
