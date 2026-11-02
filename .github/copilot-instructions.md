# Copilot Instructions

## Build, test, and package

```powershell
npm install
npm run compile       # Type-check, bundle extension, materialize dist/plugin
npm run watch         # Watch/rebuild the extension bundle
npm run lint          # ESLint repository sources
npm test              # Compile/run Node suites, then validate plugin contracts
npm run test:compile  # Compile core/tests without running them
npm run package       # Compile, then create the release VSIX with vsce
npm run package:plugin # Package separate plugin .tar.gz using tar
npm run test:plugin   # Validate materialized skills/agent/tool references
```

Run one test after compiling:

```powershell
npm run test:compile
node .\out\test\aceAviator.test.js
```

The shipped integration is an Agent Plugins 1.0 package plus companion VS Code extension. Install the VSIX with **Extensions: Install from VSIX...** and the materialized/extracted plugin with **Chat: Install Plugin from Source**. There is no Express server, React UI, independent model/CLI chat process, or environment-file setup.

## Structure

### `src/extension/`

- `extension.ts` — activation; registers shared workflow tools/commands/MCP and temporary Local participant.
- `participant.ts` — temporary Local-harness fallback only; deprecated/unsupported in Copilot.
- `toolRegistry.ts` — six workflow/editor operations, four deterministic tools, and five source tools.
- `workflowRuntime.ts` — explicit target-bound workflows, trusted tool-result staging, and editor adapter.
- `lmToolBridge.ts` — resolves and invokes native MCP tools through `vscode.lm`.
- `mcpProvider.ts` — Playwright stdio and EmailCompanion HTTP definitions.
- `linkedinSession.ts` — headed LinkedIn sign-in, manual verification, saved storage state, and status validation.
- `output.ts` — safe workspace-relative HTML file selection, section merge, and preview.
- `config.ts` — VS Code settings and EmailCompanion API key `SecretStorage`.

### `src/skills/`

- `dateWindow.ts`, `aceAviator.ts`, `productGroup.ts`, `communityNews.ts` — deterministic date-window and newsletter section skills.

### `src/tools/`

- `emailTools.ts`, `playwrightTools.ts` — MCP-backed EmailCompanion and Playwright tool definitions.

### `src/prompts/`

- `aceAviator.md`, `communityNews.md`, `productGroup.md`, `dateWindow.md` — plain Markdown workflow prompts; edit these files to change prompt text without TypeScript escaping.
- `skillDetection.ts` — pure `SkillPromptKey` detection logic, kept separate so plain Node tests do not require `.md` files.
- `skillPrompts.ts` — imports the Markdown prompts and exports `SKILL_PROMPTS` and `buildDynamicPrompt`.
- `md.d.ts` — ambient declaration for `.md` imports.

### `src/core/`

Framework-independent shared kernel, composition, and domain layer:

- `agent.ts` — skill/tool registry, composition, and dispatch.
- `newsletter.ts`, `newsletterRequest.ts` — document composition and request parsing.
- `mcpBridge.ts`, `mcpClientProtocol.ts` — MCP bridge contracts and protocol types.
- `calendarDate.ts`, `contentSafety.ts` — shared date, HTML, and URL helpers.
- `types.ts`, `index.ts` — shared JSON-schema definitions and exports.
- `newsletterWorkflow.ts` — framework-independent workflow state and ordered section transitions.

### `plugin/`

- `plugin.json` — Agent Plugins 1.0 manifest; no duplicate native MCP configuration.
- `skills/<name>/SKILL.md` — six explicitly invoked workflow wrappers.
- `com.github.copilot/agents/aviators.agent.md` — specialist role, qualified extension-tool references, no fixed model.
- `references/workflow.md` — common Copilot staging/continuation rules. Build copies canonical `src/prompts/*.md` references into `dist/plugin`; the source template is not directly installable.

### Tests and build

- `test/*.test.ts` are self-contained Node.js tests using local helper functions; no test framework is used.
- `test/run.ts` launches the compiled test files.
- `esbuild.mjs` bundles `src/extension/extension.ts` as CommonJS for VS Code.
- `scripts/build-plugin.mjs` materializes/archives a closed list of plugin assets and synchronizes its version with the companion.
- `tsconfig.json` type-checks extension/core/tests; `tsconfig.test.json` emits core/tests to `out/`.
- `.github/workflows/release.yml` validates tags and publishes matching versioned VSIX/plugin artifacts.

## Runtime conventions

- Use TypeScript throughout the extension and shared newsletter code.
- Source imports include `.js` specifiers where required for emitted/bundled module resolution.
- Keep VS Code-specific APIs in `src/extension/`; keep reusable logic split between `src/skills/`, `src/tools/`, `src/prompts/`, and the shared kernel/composition/domain layer in `src/core/`.
- Canonical workflow Markdown is inlined for Local and copied into the separate plugin package; rebuild after prompt edits. Keep detailed workflow guidance single-sourced. `.vscodeignore` excludes plugin assets from the companion VSIX.
- Keep `vscode` imports out of `src/core/`, `src/skills/`, `src/tools/`, and `src/prompts/`; ESLint enforces this boundary.
- Skills/tools use `{ name, description, parameters, execute }` with JSON Schema parameters.
- Skills return structured results, normally `{ success, html, ... }` for generated sections.
- Section HTML uses anchors `aceaviator`, `productnews`, and `communitynews`.
- Preserve the anti-fabrication rules: real user/tool data only; report missing or failed data.
- Process requested sections sequentially: Ace Aviator → Product Group → Community.
- Copilot owns the conversation/model loop; the plugin has no model client. Local uses `request.model`; never add a separate SDK or fixed model.
- Register tools with `vscode.lm.registerTool`, preserve incoming opaque invocation tokens for nested MCP, and reject missing context. Never serialize a token or infer a durable chat identity from it.
- Plugin section builders/scraping pass the extension-created `workflowId`; stage validated full results before model truncation and reject stale/out-of-order continuation. Do not accept model-provided prior HTML or internal generation state.
- Generated output is staged. Completed section commands share one pending target draft and original conflict baseline; rebind apply/discard guards to the newest handle. Explicit chat persist with host confirmation or palette apply saves the full draft. Incomplete work blocks persistence; ambiguous targets require a picker. Protect external/unsaved-editor conflicts and report actual save status.
- The extension programmatically registers Playwright and EmailCompanion MCP servers; do not add a duplicate workspace `.vscode/mcp.json`.
- Store the EmailCompanion API key only in VS Code `SecretStorage`. Keep endpoints and non-secret behavior in contributed `aviators.*` settings.
- LinkedIn sign-in must remain user-driven and support manual verification before saving browser state.
- Newsletter files must remain inside the configured workspace-relative output folder.
- Use bracketed `console` prefixes for operational diagnostics where logging is useful.

## Extension surface

- Copilot: Aviators custom-agent picker and `/aviators-newsletter:newsletter`, `:ace`, `:product`, `:community`, `:preview`, `:persist`.
- Temporary Local fallback: `@aviators` and its five old slash commands; remove only after live acceptance.
- Command Palette: preview, key set/delete, LinkedIn sign-in/status, MCP diagnostics, proposal review/apply/discard, workflow status.
- Fifteen LM tools: nine source/build tools plus begin/template/status/review/persist/preview workflow operations.
- Native MCP: Playwright stdio plus EmailCompanion streamable HTTP
- Distribution: matching GitHub release VSIX/plugin archive, not assumed marketplace availability. Connected VS Code companion required.
