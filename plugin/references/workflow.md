# Connected companion workflow contract

These Copilot instructions override participant-specific orchestration, output, and continuation text in the shared source procedures. Treat example names, Q&A, URLs, and dates there as illustrative, never as newsletter source data.

## Binding and sequence

- Require the companion VSIX in the connected VS Code workspace and its enabled tools. Tool references use `aviators.aviators-newsletter/` followed by the operation name. If a tool, provider, approval, or service is unavailable, report the exact missing/failed operation and stop that dependent work. Never substitute generic file writes, invented content, or a success-shaped response.
- Confirm the newsletter month and requested sections. Compute the date window first with `aviators.aviators-newsletter/computeDateWindow({month})`.
- Before section retrieval or generation, call `aviators.aviators-newsletter/beginNewsletterWorkflow({month, sections, fileName?, workspaceFolder?})`. `sections` is a required, unique, nonempty array containing only `aceAviator`, `productGroup`, or `community`; `workspaceFolder`, when supplied, is a workspace folder URI, not a filesystem path. Retain the returned `workflowId`, `outputUri`, and status. Never invent a handle or infer it from a filename.
- For an existing handle, call `aviators.aviators-newsletter/getNewsletterWorkflow({workflowId})` before continuing. Check trusted selected-section, staged, pending, and proposal state. Do not start a replacement workflow to resume pending work.
- Separate completed section commands for the same newsletter share one accumulated pending draft. Beginning the next section preserves earlier section changes; regenerating a section replaces only that section. `draftSections` lists all accumulated sections, while `stagedSections` describes the selected workflow. Use the same month, filename and workspace target across commands. Incomplete work must be completed or explicitly discarded before starting another section.
- Process only requested sections, strictly Ace Aviator → Product Group → Community. Complete and check trusted status for each selected section before starting the next. An explicit single-section skill does not authorize the other sections.
- Pass the same `workflowId` to every `aviators.aviators-newsletter/createAceAviator`, `aviators.aviators-newsletter/createProductGroupNews`, `aviators.aviators-newsletter/createCommunityNews`, and `aviators.aviators-newsletter/scrapeLinkedIn` call. The other source tools retain their existing inputs; do not add unsupported handle fields.

## Trusted batches and resume

The companion stages full generation results and retains accumulated Community data. Never copy previous newsletter HTML into a tool call or write returned HTML yourself. After interruption, use `getNewsletterWorkflow` with the same handle; process trusted pending batch data before scraping more, and use its remaining URLs for continuation. If pending state is unclear, report it rather than reconstructing it from chat text.

Follow the canonical Community source procedure until every remaining URL is processed or explicitly reported failed/skipped. Match `hasMore` to trusted remaining work, including a final short batch. Do not claim completion while URLs or a pending batch remain. A reload invalidates in-memory handles: report a stale handle and request a fresh workflow; do not claim cross-restart resumability.

## Review, apply, preview

After staging, inspect `getNewsletterWorkflow`, then call `aviators.aviators-newsletter/reviewNewsletterWorkflow({workflowId})` to open the complete accumulated target diff. Do not persist automatically after section generation.

On explicit `/aviators-newsletter:persist` or another explicit user instruction to save the draft, call `aviators.aviators-newsletter/persistNewsletterDraft({workflowId?})`. A known handle selects its target and saves that newsletter's latest complete draft, including later section commands. Without a known target, omit the handle: the companion saves the only pending draft or asks the user to select when multiple targets have drafts. Never guess the newest newsletter, begin a new workflow to save, or pass model-provided HTML. Host confirmation remains required.

The Command Palette's **Aviators: Apply Pending Newsletter Changes** saves the same full draft; **Aviators: Discard Pending Newsletter Changes** discards that entire pending target draft. Unfinished sections/batches block persistence from either surface; complete the work or explicitly discard. Cancelling selection or confirmation must not save anything.

Report generated, staged, incomplete, discarded, applied-to-editor, and saved-to-disk states distinctly according to actual tool results. Applying an editor edit is not proof of a disk save. Conflicting/unsaved target changes must not be overwritten.

`aviators.aviators-newsletter/openNewsletterPreview({workflowId})` previews the existing target document, not an unstaged proposal. Without a handle it opens an existing-file picker. Review proposed changes in the diff; preview reflects the applied target and may include unsaved editor changes, so it is not evidence of persistence.
