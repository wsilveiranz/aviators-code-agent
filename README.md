# Aviators Newsletter

A Copilot agent plugin plus a companion Visual Studio Code extension for creating Logic Apps Aviators newsletter HTML. The plugin provides explicit skills and an Aviators specialist agent; the companion provides validated section tools, reviewable output, native MCP services, and secure editor integration. Copilot owns the conversation and uses the model selected in chat.

Distribution is a VSIX plus an extracted plugin archive from GitHub releases, not assumed marketplace availability. The deprecated `@aviators` participant remains temporarily for **Local harness compatibility only** while live Copilot acceptance is completed.

## Requirements

- A current VS Code version supporting the Copilot harness and Agent Plugins 1.0. The migration targets the reported 1.145 Insiders build; a migration-wide stable minimum has not yet been verified. The companion's existing Local API baseline remains 1.102.
- GitHub Copilot Chat access and an available model that supports tool calling.
- An open workspace folder; generated newsletters are written into the workspace.
- Docker for the default Playwright MCP command.
- Node.js 20 and npm for extension development and for the default headed LinkedIn sign-in fallback.
- For Ace Aviator email retrieval, an EmailCompanion HTTPS MCP endpoint and API key. Plaintext HTTP is supported only on loopback hosts for development.

## Install the release VSIX

1. Download `aviators-newsletter.vsix` from the repository's [GitHub Releases](https://github.com/wsilveiranz/aviators-code-agent/releases).
2. In VS Code, run **Extensions: Install from VSIX...** from the Command Palette and select the downloaded file.
3. Reload VS Code if prompted.

Download the matching `aviators-newsletter-plugin-<version>.tar.gz`, extract it, then run **Chat: Install Plugin from Source** and select the extracted folder containing `plugin.json`. Enable it for the intended workspace through **Chat: Open Customizations**. Keep the companion installed and the editor connected; this first migration does not support standalone CLI, app, cloud, or disconnected execution.

Do not install the repository's `plugin` template folder directly: development builds materialize its canonical workflow references in `dist\plugin`.

You can also install it from a terminal:

```powershell
code --install-extension .\aviators-newsletter.vsix
```

For the development build:

```powershell
npm run compile
npm run package -- --out .\release\aviators-newsletter-0.2.1.vsix
npm run package:plugin
```

Install the VSIX and select `C:\dev\aviators-code-agent\dist\plugin` through **Chat: Install Plugin from Source**. Update both the companion and plugin to 0.2.1 for chat persistence; uninstalling the previous companion is unnecessary.

## Use the Copilot plugin

Start a fresh **Copilot** harness chat, select **Aviators** in the agent picker, and invoke an explicit skill:

| Skill | Purpose |
|---|---|
| `/aviators-newsletter:newsletter` | Create or open a template; never generate all sections automatically. |
| `/aviators-newsletter:ace` | Generate the Ace Aviator section from supplied Q&A or approved email retrieval. |
| `/aviators-newsletter:product` | Compute the date window and generate Product Group News from actual sources. |
| `/aviators-newsletter:community` | Scrape and process every Community source batch with trusted continuation. |
| `/aviators-newsletter:preview` | Open an existing newsletter document. |
| `/aviators-newsletter:persist` | Save the complete accumulated newsletter draft from chat, with confirmation. |

For generation, the skills begin an explicit month/target/section workflow and pass its returned `workflowId` to section tools and LinkedIn scraping. Keep that handle for continuation and use `getNewsletterWorkflow` to check pending batches and proposal status. It is an extension-owned lookup key, not a chat identity or authorization token. Stale handles after editor reload are rejected.

Workflow state is bounded to 100 retained workflows per extension session; reaching the limit reports an error rather than silently evicting pending work. Save or discard pending work before reloading the editor to reset that state.

Generated HTML is **staged, not applied**. Completed section commands for the same month/target accumulate in one draft: run `:product`, then `:community`, then `/aviators-newsletter:persist` to save both changes, including when persistence uses the earlier command's workflow handle. Regenerating a section replaces that section without losing the others. Nothing is saved automatically.

Persistence requires explicit confirmation and a complete workflow, including every Community batch. An unfinished workflow must be completed or explicitly discarded, not silently replaced or partially saved. When several newsletter targets have drafts and no target is specified, a picker requires your selection; cancellation saves nothing. Existing unsaved-editor and external-file conflict checks still apply.

**Aviators: Review Pending Newsletter Changes** shows the full accumulated diff. The Command Palette's **Apply Pending Newsletter Changes** saves the same full draft; **Discard Pending Newsletter Changes** discards the entire pending target draft. Palette commands remain available, but are no longer required to persist.

Cancelled staging and entirely failed Community scraping do not produce an applicable empty replacement. Existing content is preserved, and failed source batches retain trusted retry state rather than being reported as completed.

When the companion or required tools are unavailable, report the missing capability rather than falling back to invented content or generic file writes. Do not configure duplicate Playwright/EmailCompanion servers in a plugin or workspace.

## Small live smoke tests (no full newsletter required)

Automated tests cover composition, fixtures, and state transitions. They cannot prove live Copilot discovery, token forwarding, approvals, or authentication. Run the following in a **disposable empty workspace**, not an existing newsletter. Each prompt is intentionally small; review the tool activity, not just the final model text.

For tests 1-4, disable `aviators.newsletter.enableMcpProvider` in that test workspace to avoid starting browser/email services. No email API key, LinkedIn login, or external source data is needed. Restore the setting only for the optional network test.

1. **Discovery/date calculation:** confirm the plugin's six skills and Aviators agent appear, then send:

   ```text
   Use #computeDateWindow once for November 2026. Do not browse, retrieve email, or generate a newsletter.
   ```

   Expected: one date tool call, with date boundaries October 6 through November 1, 2026. Failure to discover the extension tool is a live-host failure, not a date calculation failure.

2. **Template/preview:** send:

   ```text
   /aviators-newsletter:newsletter November 2026. Create only the template. Do not retrieve data or generate sections.
   ```

   Expected: `createNewsletterTemplate`, `newsletters\November-2026.html`, and no network tools. Repeat once: the existing file must not be replaced. Then run `/aviators-newsletter:preview` and confirm the file opens.

3. **Staging/review using supplied test data:** send:

   ```text
   /aviators-newsletter:ace November 2026. This is an explicitly synthetic smoke-test fixture, not a real interview. Use only these supplied Q&A pairs; do not access email, LinkedIn, or the web.
   Name: Fixture Aviator
   Q: What's your role and title? A: I maintain this synthetic test newsletter.
   Q: Can you give us insights into your day-to-day activities? A: I check deterministic test fixtures each day.
   Q: What motivates you to be an active member? A: This fixture verifies supplied data is preserved.
   Q: Looking back, what advice would you give? A: Review proposed changes before applying them.
   Q: What has helped you grow professionally? A: Repeatable checks have improved this test process.
   Q: If you had a magic wand for Logic Apps? A: I would make every test failure easy to explain.
   ```

   Expected: a begin-workflow call, `createAceAviator` with the same `workflowId`, and a pending proposal; no network calls. The template remains unchanged until you persist. Review and discard once, verifying no content changed. Repeat and run `/aviators-newsletter:persist`, approve confirmation, and verify the fixture appears in the saved HTML with other sections unchanged.

   For a no-network accumulation check, before persisting run `:product` for November 2026 using only this explicitly synthetic supplied post: title `Synthetic product fixture`, link `https://example.com/synthetic-product`, publishedAt `2026-10-20`, summary `This is supplied smoke-test data, not a real announcement.` Explicitly request no browsing or retrieval. Review the combined draft, then persist from chat and verify both the Ace fixture and Product fixture appear in the saved HTML.

4. **Invalid state:** send:

   ```text
   Call #getNewsletterWorkflow once with workflowId "not-a-real-workflow". Report the error without retrying, starting a workflow, or modifying files.
   ```

   Expected: an explicit unknown/stale-workflow error and no file writes. **Aviators: Show Newsletter Workflow Status** provides the editor-side status without requiring another model request.

5. **Optional native MCP boundary:** only after tests 1-4 pass, enable the provider and start/trust Playwright. Send:

   ```text
   Call #playwright_navigate once for https://example.com and report only whether actual page content was returned. Do not follow links or create newsletter content.
   ```

   Expected: the companion's outer tool and a nested native Playwright call with actual page content. Separately reject the confirmation and test cancellation; neither may be reported as a successful retrieval. These actions still use Copilot credits and browser prerequisites, but avoid a full newsletter or private sources.

Community batching, stale continuations, and source errors are tested with automated fixtures rather than live LinkedIn for this smoke checklist. Real EmailCompanion/LinkedIn authentication remains a separate user-driven integration check; a successful date/template test does not establish it.

## Configure the extension

Open VS Code Settings and search for **Aviators Newsletter**, or add settings to workspace/user `settings.json`.

| Setting | Default | Purpose |
|---|---|---|
| `aviators.output.folder` | `newsletters` | Workspace-relative directory for generated HTML. Absolute paths and `..` are rejected. |
| `aviators.playwright.headless` | `true` | Adds `--headless` to the runtime Playwright MCP server. |
| `aviators.playwright.mcpCommand` | Docker command shown below | Executable and arguments used for the Playwright stdio MCP server. |
| `aviators.email.mcpEndpoint` | empty | EmailCompanion HTTPS MCP endpoint. HTTP is allowed only on `localhost`, `127.0.0.1`, or `::1`. |
| `aviators.maxToolRounds` | `12` | Temporary Local participant only (1-50); does not limit the Copilot harness. |
| `aviators.newsletter.enableMcpProvider` | `true` | Enables the extension's native Playwright and EmailCompanion MCP definitions. |

Default Playwright MCP command:

```json
{
  "command": "docker",
  "args": [
    "run",
    "-i",
    "--rm",
    "--init",
    "mcr.microsoft.com/playwright/mcp"
  ]
}
```

The extension registers these servers programmatically, so a workspace `.vscode/mcp.json` is not required:

- **Playwright** — stdio server using `aviators.playwright.mcpCommand`. The default Docker command mounts extension global storage and uses a container-visible saved state path. The extension omits `--storage-state` until the file exists, then also adds `--isolated` and optionally `--headless`.
- **EmailCompanion** — HTTP server using `aviators.email.mcpEndpoint`. During resolution, the extension adds the stored API key as `X-API-Key`, so remote endpoints must use HTTPS.

### Store or remove the EmailCompanion API key

Run **Aviators: Set Email API Key** from the Command Palette. The value is stored in VS Code `SecretStorage`, not in workspace files. Submit an empty value to delete the stored key.

## Sign in to LinkedIn

1. Run **Aviators: Sign in to LinkedIn**.
2. Complete sign-in in the headed browser.
3. Complete any LinkedIn verification or challenge manually.
4. Return to VS Code and select **Save Session**.

The saved browser state is kept under the extension's global storage and reused by the runtime Playwright MCP definition. When the configured command is Docker, the sign-in command uses a local `npx @playwright/mcp@latest` process because the login flow needs a visible browser.

Run **Aviators: Check LinkedIn Session Status** to validate that a non-expired LinkedIn `li_at` authentication cookie exists on an exact LinkedIn domain. LinkedIn may require sign-in or manual verification again at any time.

The extension does not bundle or install Playwright MCP. With the default configuration, Docker pulls `mcr.microsoft.com/playwright/mcp` when the image is missing. To use the npm distribution instead, configure:

```json
"aviators.playwright.mcpCommand": {
  "command": "npx",
  "args": ["--yes", "@playwright/mcp@latest"]
}
```

Run **Aviators: Check Playwright MCP Status** to verify that VS Code has discovered `browser_navigate`. If it has not, run **MCP: List Servers**, start and trust Playwright, and inspect **Show Output**. The extension waits briefly for delayed MCP tool discovery before reporting a missing Playwright tool.

## Temporary Local fallback: `@aviators`

[VS Code has deprecated chat participants](https://code.visualstudio.com/api/extension-guides/ai/chat). The following commands work only with **Local** selected as the Session Target. They are not the Copilot plugin's entry points, and will be retired after live replacement acceptance.

Open Copilot Chat, choose a model in the Copilot model picker, and address the participant:

```text
@aviators /newsletter Create the newsletter for August 2026.
```

The participant uses `request.model`, so each request runs with the model selected in Copilot Chat. There is no separate model or model-provider setting in this extension.

### Slash commands

| Command | Purpose |
|---|---|
| `@aviators /newsletter` | Create or open the persistent newsletter template without calling a model. |
| `@aviators /ace` | Generate only the Ace Aviator section. |
| `@aviators /product` | Compute the newsletter window and generate only Product Group News. |
| `@aviators /community` | Compute the newsletter window and generate only Community News, including all supplied URL batches. |
| `@aviators /preview` | Open the current newsletter HTML without calling a model. |

Without a slash command, the participant acts as a newsletter-aware specialist and detects the relevant action from the prompt. Requests to create or initialize a template are handled deterministically without calling a model. The resulting file becomes the current chat newsletter, and `/ace`, `/product`, and `/community` update that same artifact independently. Only an explicit request for the full or entire newsletter loads every section workflow.

The participant reconstructs prior user and assistant text from the current chat and injects the contents of explicitly referenced text files. For each request, it exposes every tool currently registered in `vscode.lm.tools`, including available GitHub Copilot, built-in, extension, and MCP tools. It also supplies private workspace list/read/search helpers and an exact-text replacement tool for reliable small edits when a general patch tool cannot apply its patch. Explicitly attached `#tool` references are honored as required calls.

`aviators_replaceWorkspaceText` is workspace-bound, requires the old text to match the current file exactly, rejects ambiguous matches by default, applies the change through a VS Code workspace edit, and saves the document. This is the preferred fallback for corrections such as updating an existing LinkedIn URL without regenerating a newsletter section.

The stable Chat Participant API does not currently expose Agent mode's enabled/disabled tool-picker map to Marketplace extensions. As a result, `@aviators` can use all tools published through the stable Language Model Tools API, but it cannot inherit Copilot-only proposed/internal capabilities or exactly mirror the user's Agent mode tool selection.

### Language-model tools

The companion contributes fifteen tools: nine existing source/build tools and six workflow/editor operations, including confirmed whole-draft persistence. Custom-agent references qualify them with `aviators.aviators-newsletter/`.

| Tool reference | Registered name | Role |
|---|---|---|
| `beginNewsletterWorkflow` | `aviators_beginNewsletterWorkflow` | Bind the month, workspace, target, and ordered requested sections. |
| `createNewsletterTemplate` | `aviators_createNewsletterTemplate` | Create/open a template without overwriting an existing file. |
| `getNewsletterWorkflow` | `aviators_getNewsletterWorkflow` | Inspect trusted pending/staged/proposal status. |
| `reviewNewsletterWorkflow` | `aviators_reviewNewsletterWorkflow` | Open the pending proposal diff without applying. |
| `openNewsletterPreview` | `aviators_openNewsletterPreview` | Open an existing newsletter safely. |
| `computeDateWindow` | `aviators_computeDateWindow` | Calculate the PST/PDT newsletter date window. |
| `createAceAviator` | `aviators_createAceAviator` | Generate Ace Aviator section HTML from supplied email/Q&A data. |
| `createProductGroupNews` | `aviators_createProductGroupNews` | Generate Product Group section HTML from real posts. |
| `createCommunityNews` | `aviators_createCommunityNews` | Generate one escaped Community batch; `workflowId` enables trusted plugin accumulation/staging. |
| `getEmailFromMCP` | `getEmailFromMCP` | Retrieve the Ace Aviator source email through EmailCompanion MCP. |
| `scrapeLinkedIn` | `aviators_scrapeLinkedIn` | Visit LinkedIn activity URLs in batches through Playwright MCP. |
| `resolveRedirects` | `aviators_resolveRedirects` | Resolve supplied URLs through Playwright MCP. |
| `playwright_navigate` | `playwright_navigate` | Visit linked external pages and return their content through Playwright MCP. |
| `getTechCommunityBlogPosts` | `aviators_getTechCommunityBlogPosts` | Fetch and date-filter Integration on Azure blog posts through Playwright MCP. |

Network tools can display VS Code confirmation prompts before visiting supplied URLs.

## Workspace HTML output

The Copilot workflow binds its target explicitly through `beginNewsletterWorkflow`, stages full validated tool results before model-context truncation, and enforces requested-section order. Bare builder calls without a `workflowId` return standalone HTML; they are not a Copilot save operation.

When a section tool returns recognizable newsletter HTML, or `createCommunityNews` returns a structured batch, the extension:

1. Selects the workspace from request references, the active editor, or a workspace picker.
2. Writes to `<workspace>/<aviators.output.folder>/<Month>-<Year>.html`.
3. Preserves other recognizable sections. A request's first Community batch replaces stale Community output; later batches are rebuilt from trusted extension-owned items without accepting prior HTML from the model.
4. Stages the complete file update without changing the workspace file, opens a diff, and provides **Review changes**, **Apply changes**, and **Discard changes** actions.

For example, August 2026 is proposed for `newsletters/August-2026.html`. If the request has no recognizable month, the current UTC month and year are used when output is first required. The extension applies the proposal through a VS Code workspace edit only after **Apply changes**, making it undoable and refusing to apply it if the file changed after the diff was created.

The preview command opens the HTML document in a VS Code editor. It does not run a separate web application or server.

## Command Palette commands

- **Aviators: Open Current Newsletter Preview**
- **Aviators: Set Email API Key**
- **Aviators: Sign in to LinkedIn**
- **Aviators: Check LinkedIn Session Status**
- **Aviators: Check Playwright MCP Status**
- **Aviators: Review Pending Newsletter Changes**
- **Aviators: Apply Pending Newsletter Changes**
- **Aviators: Discard Pending Newsletter Changes**
- **Aviators: Show Newsletter Workflow Status**

## Develop and package

```powershell
npm install
npm run compile
npm run lint
npm test
npm run package
.\scripts\build-vsix.ps1 -Version 0.1.1
```

| Command | Purpose |
|---|---|
| `npm run compile` | Type-check with TypeScript and bundle `src/extension/extension.ts` to `dist/extension.cjs` with esbuild. |
| `npm run watch` | Rebuild the esbuild bundle when extension source changes. |
| `npm run lint` | Lint the TypeScript and JavaScript sources with ESLint. |
| `npm test` | Compile core/tests to `out/` and run the plain Node.js test runner. |
| `npm run test:compile` | Compile only the core and test sources for Node.js tests. |
| `npm run package` | Create a VSIX with `vsce package --no-dependencies`; this runs the prepublish compile step. |
| `npm run package:plugin` | Materialize canonical workflow resources and create the separate plugin `.tar.gz` using `tar`. |
| `npm run test:plugin` | Validate plugin manifests, skill/agent contracts, tool references, and materialized links. |
| `.\scripts\build-vsix.ps1 -Version 0.1.1` | Validate and build `release/aviators-newsletter-0.1.1.vsix` with a temporary version override; restores `package.json` and `package-lock.json` afterward. |

To run one compiled test:

```powershell
npm run test:compile
node .\out\test\aceAviator.test.js
```

Tagged releases use the `v*` tag as the effective companion and generated plugin version, run lint and tests, and attach `aviators-newsletter-<version>.vsix` plus `aviators-newsletter-plugin-<version>.tar.gz` to the GitHub release. Plugin resources are packaged separately and do not become discoverable merely by installing a VSIX. Development/package hosts need `tar` (included with current Windows and Ubuntu).

See [ARCHITECTURE.md](ARCHITECTURE.md) for component and data-flow details.

## License

MIT
