# Aviators Newsletter plugin

Version **0.2.1** pairs explicit Copilot skills and an Aviators specialist with the matching companion VSIX. This `plugin\` source directory is an authored template, **not directly installable**: its canonical workflow references are materialized during packaging.

## Build and install

From the repository, run `npm run compile` or `node .\scripts\build-plugin.mjs --prepare` to produce the self-contained `dist\plugin\` folder. Run `npm run package:plugin` to create the release archive. Packaging copies the four canonical `src\prompts\*.md` files into `dist\plugin\references\`, alongside the authored [companion contract](references/workflow.md). Do not hand-edit duplicate workflow copies.

Install the matching VSIX using VS Code **Extensions: Install from VSIX...**. In the intended connected VS Code workspace, use **Chat: Install Plugin from Source** and select the materialized `dist\plugin\` folder, or extract the release plugin artifact and select its folder containing root `plugin.json`. Do not select repository `plugin\` or assume a repository URL installs that nested directory. Confirm skills and the agent in Agent Customizations using the Copilot harness; listing them is not proof of working calls.

The companion's temporary `@aviators` participant is Local-only fallback pending live acceptance. It is not required by these Copilot skills. Do not enable duplicate plugin copies or duplicate MCP definitions.

## Explicit commands

Select **Aviators** in the agent picker for its persistent specialist role; it does not preload or automatically run the skills.

| Command | Purpose |
| --- | --- |
| `/aviators-newsletter:newsletter` | Create/open a month template only; never overwrite an existing file or generate sections. |
| `/aviators-newsletter:ace` | Stage supplied interview Q&A or approved email data. |
| `/aviators-newsletter:product` | Stage date-filtered, actually read Product Group sources. |
| `/aviators-newsletter:community` | Stage real Community sources and continue every trusted batch. |
| `/aviators-newsletter:preview` | Preview the existing target or choose an existing newsletter. |
| `/aviators-newsletter:persist` | Save the complete accumulated target draft from chat, with confirmation. |

Supply month/year, source inputs, optional target filename/workspace folder URI, and an existing `workflowId` when continuing. Section skills start only their named section unless the user has explicitly selected a multi-section workflow. Requested sections run Ace → Product → Community. Handles are in-memory, target-bound companion state; editor reload invalidates them.

Generated sections are staged proposals, not immediate file replacements. Completed section commands for the same target share one accumulated draft: `:product`, then `:community`, then `:persist` saves both. An earlier known workflow handle selects the latest full draft for its target, not a historical section. Regenerating a section preserves other sections.

Use `/aviators-newsletter:persist` only on an explicit save request and approve host confirmation. Unfinished sections/batches block persistence and starting another section; complete the work or explicitly discard. With multiple pending newsletters and no target, the companion shows a picker rather than guessing; cancellation saves nothing. Review opens the full draft diff. **Aviators: Apply Pending Newsletter Changes** saves the same draft, and **Aviators: Discard Pending Newsletter Changes** discards the entire pending target draft. Status remains available through **Aviators: Show Newsletter Workflow Status**.

Preview shows the existing target (possibly unsaved editor changes), not an unstaged proposal. A preview or editor edit is not proof of disk persistence; report actual save status. Update both plugin and companion for the persist command.

## Services and boundaries

The connected companion owns editor access, output-folder confinement, bounded generation, review, dynamic Playwright/EmailCompanion MCP definitions, and browser authentication. This plugin intentionally has **no `mcp.json`**. Standalone/disconnected CLI, app, or cloud execution is not supported in this first release.

Configure non-secret endpoints/behavior in `aviators.*` settings. Use **Aviators: Set Email API Key** for companion SecretStorage; blank input deletes the key. Never put API keys in the plugin, workspace MCP files, environment exports, source fixtures, browser logs, or chat. LinkedIn sign-in and any manual verification remain user-driven through the companion commands. Failures, missing approval/tools/authentication, and incomplete batches must be reported, not silently replaced by generic file writes or fabricated success.

The explicit tool list is not a security sandbox for other tools a user enables. Review permissions and actual diffs.

## Low-cost synthetic smoke example

Use a disposable newsletter workspace. This prompt is an **explicitly user-supplied synthetic fixture**, not a real newsletter source:

```text
/aviators-newsletter:newsletter November 2026, fileName "synthetic-smoke.html".
Create/open the template only. Do not retrieve email or browse.
```

Then supply the synthetic interview explicitly:

```text
/aviators-newsletter:ace November 2026, name "Synthetic Test Aviator",
fileName "synthetic-smoke.html". This is a user-supplied synthetic test
fixture, not a real interview. Use only this qaPairs array:
[{"question":"What's your role and title?","answer":"I am a synthetic fixture."},
 {"question":"What does your day-to-day involve?","answer":"Checking a test draft."},
 {"question":"What motivates you?","answer":"Verifying a bounded tool call."},
 {"question":"What advice would you give?","answer":"Review before applying."},
 {"question":"What helped you grow?","answer":"Repeatable synthetic checks."},
 {"question":"What Logic Apps feature would you create?","answer":"No real feature request; this is test data."}]
Do not use email, LinkedIn, external pages, or invented profile URLs.
Stage and open review only; do not apply or save.
```

Expected: a real companion date call, target-bound handle, staged synthetic Ace proposal, and the correct diff; no inbox/LinkedIn call, automatic apply, or real-source claim. Missing tools must produce an explicit failure instead. These examples and local contract tests do **not** establish live tool discovery, nested invocation approvals/tokens, SecretStorage behavior, or installed-artifact compatibility. Those remain manual release acceptance gates.
