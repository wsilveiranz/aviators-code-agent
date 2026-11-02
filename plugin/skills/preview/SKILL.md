---
name: preview
description: Explicitly preview an existing newsletter target without generating, applying, or saving changes.
argument-hint: "Optional workflowId; otherwise choose an existing newsletter"
disable-model-invocation: true
---
# Preview existing output

Invoke as `/aviators-newsletter:preview`.

Read the [connected companion contract](../../references/workflow.md).

If the user supplies `workflowId`, inspect `aviators.aviators-newsletter/getNewsletterWorkflow({workflowId})`, report any incomplete or staged proposal, and call `aviators.aviators-newsletter/openNewsletterPreview({workflowId})`. Otherwise call `aviators.aviators-newsletter/openNewsletterPreview({})` for the existing-document picker.

Preview shows the existing target, not an unstaged proposal. Use `aviators.aviators-newsletter/reviewNewsletterWorkflow({workflowId})` only when the user asks to review proposed changes. Do not generate content, create a replacement template, apply a proposal, or claim preview saved the file. Report missing/stale targets or unavailable companion tools explicitly.
