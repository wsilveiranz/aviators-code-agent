# Copilot Instructions

## Build, test, and package

```powershell
npm install
npm run compile       # Type-check all TS, bundle dist/extension.cjs with esbuild
npm run watch         # Watch/rebuild the extension bundle
npm run lint          # ESLint repository sources
npm test              # Compile core/tests to out/ and run out/test/run.js
npm run test:compile  # Compile core/tests without running them
npm run package       # Compile, then create the release VSIX with vsce
```

Run one test after compiling:

```powershell
npm run test:compile
node .\out\test\aceAviator.test.js
```

The shipped runtime is a VS Code extension. Install the generated VSIX with **Extensions: Install from VSIX...** or `code --install-extension <file>.vsix`. There is no Express server, React UI, CLI chat process, or environment-file setup.

## Structure

### `src/extension/`

- `extension.ts` — activation; registers `@aviators`, commands, seven language-model tools, and the MCP provider.
- `participant.ts` — slash-command routing, dynamic prompts, `request.model` loop, token/tool-round limits, and output integration.
- `toolRegistry.ts` — four local skills plus three MCP-backed VS Code language-model tools.
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

### Tests and build

- `test/*.test.ts` are self-contained Node.js tests using local helper functions; no test framework is used.
- `test/run.ts` launches the compiled test files.
- `esbuild.mjs` bundles `src/extension/extension.ts` as CommonJS for VS Code.
- `tsconfig.json` type-checks extension/core/tests; `tsconfig.test.json` emits core/tests to `out/`.
- `.github/workflows/release.yml` validates version tags and attaches `aviators-newsletter.vsix` to GitHub releases.

## Runtime conventions

- Use TypeScript throughout the extension and shared newsletter code.
- Source imports include `.js` specifiers where required for emitted/bundled module resolution.
- Keep VS Code-specific APIs in `src/extension/`; keep reusable logic split between `src/skills/`, `src/tools/`, `src/prompts/`, and the shared kernel/composition/domain layer in `src/core/`.
- Prompt Markdown is inlined by `esbuild.mjs` (`loader: { ".md": "text" }`) during `npm run compile`; rebuild after prompt edits. There is no runtime file read, and `.vscodeignore` excludes `src/**`, so `.md` files are not shipped separately in the VSIX.
- Keep `vscode` imports out of `src/core/`, `src/skills/`, `src/tools/`, and `src/prompts/`; ESLint enforces this boundary.
- Skills/tools use `{ name, description, parameters, execute }` with JSON Schema parameters.
- Skills return structured results, normally `{ success, html, ... }` for generated sections.
- Section HTML uses anchors `aceaviator`, `productnews`, and `communitynews`.
- Preserve the anti-fabrication rules: real user/tool data only; report missing or failed data.
- Process requested sections sequentially: Ace Aviator → Product Group → Community.
- Use the model supplied by `ChatRequest.request.model`; do not add a separate model SDK/client or hardcoded model.
- Register model tools with `vscode.lm.registerTool` and pass the participant tool token to MCP-backed invocations.
- The extension programmatically registers Playwright and EmailCompanion MCP servers; do not add a duplicate workspace `.vscode/mcp.json`.
- Store the EmailCompanion API key only in VS Code `SecretStorage`. Keep endpoints and non-secret behavior in contributed `aviators.*` settings.
- LinkedIn sign-in must remain user-driven and support manual verification before saving browser state.
- Newsletter files must remain inside the configured workspace-relative output folder.
- Use bracketed `console` prefixes for operational diagnostics where logging is useful.

## Extension surface

- Participant: `@aviators`
- Slash commands: `/newsletter`, `/ace`, `/product`, `/community`, `/preview`
- Command Palette: open preview, set/delete email API key (blank input deletes), sign in to LinkedIn, check LinkedIn status
- Seven LM tools: `computeDateWindow`, `createAceAviator`, `createProductGroupNews`, `createCommunityNews`, `scrapeLinkedIn`, `resolveRedirects`, `getTechCommunityBlogPosts`
- Native MCP: Playwright stdio plus EmailCompanion streamable HTTP
- Distribution: GitHub release VSIX, not assumed marketplace availability
