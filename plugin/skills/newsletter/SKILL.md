---
name: newsletter
description: Explicitly create or open a newsletter template for a month without generating sections.
argument-hint: "Month and year; optional filename and workspace folder URI"
disable-model-invocation: true
---
# Newsletter template only

Invoke as `/aviators-newsletter:newsletter`.

Read the [connected companion contract](../../references/workflow.md) and [date-window helper](../../references/dateWindow.md). Require a month/year; resolve ambiguous workspace selection through the companion rather than guessing.

1. Call `aviators.aviators-newsletter/computeDateWindow({month})`.
2. Call `aviators.aviators-newsletter/createNewsletterTemplate({month, fileName?, workspaceFolder?})`.
3. Report whether the template was created or an existing document opened, and its actual target. This operation must not overwrite existing content.

Do not begin a generation workflow, fetch email, browse LinkedIn, or generate any sections. Offer the explicit `/aviators-newsletter:ace`, `/aviators-newsletter:product`, and `/aviators-newsletter:community` skills for separate user requests. Preview is `/aviators-newsletter:preview`.
