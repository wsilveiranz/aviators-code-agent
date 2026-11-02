---
name: persist
description: Explicitly persist all accumulated section changes in a newsletter draft to disk.
argument-hint: "Optional workflowId selecting the newsletter; otherwise choose a pending draft"
disable-model-invocation: true
---
# Persist newsletter draft

Invoke as `/aviators-newsletter:persist`. This invocation explicitly requests saving the current accumulated draft, not generating or replacing any sections.

Read the [companion workflow contract](../../references/workflow.md). Call `aviators.aviators-newsletter/persistNewsletterDraft` once with an existing `workflowId` only when the user or unambiguous conversation context identifies the intended newsletter. That handle selects the target, including all later section changes, even if it belongs to an earlier section workflow. Never invent a handle or choose the latest newsletter arbitrarily.

Without a known target, omit `workflowId`: the companion saves the only pending draft or shows a target picker when several newsletters have drafts. Cancelling the picker must not save anything.

Do not begin a new workflow, regenerate sections, supply prior HTML, retrieve sources, or use generic file writes to persist. An incomplete workflow or pending batch blocks persistence; report the missing work and request completion or explicit discard, not a bypass. File and unsaved-editor conflicts must remain protected.

Report the actual tool result, including target path and `saved` status. Never report a cancelled or failed save as persisted; distinguish editor-only changes from a successful disk save.
