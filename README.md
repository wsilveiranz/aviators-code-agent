# Aviators Newsletter

A Visual Studio Code extension that adds the `@aviators` GitHub Copilot Chat participant for creating Logic Apps Aviators newsletter HTML. It uses the model selected in Copilot Chat, nine extension language-model tools, and native VS Code MCP server providers.

The extension is distributed as a VSIX attached to GitHub releases. It is not documented as being available from a marketplace.

## Requirements

- Visual Studio Code 1.102 or later.
- GitHub Copilot Chat access and an available model that supports tool calling.
- An open workspace folder; generated newsletters are written into the workspace.
- Docker for the default Playwright MCP command.
- Node.js 20 and npm for extension development and for the default headed LinkedIn sign-in fallback.
- For Ace Aviator email retrieval, an EmailCompanion HTTPS MCP endpoint and API key. Plaintext HTTP is supported only on loopback hosts for development.

## Install the release VSIX

1. Download `aviators-newsletter.vsix` from the repository's [GitHub Releases](https://github.com/wsilveiranz/aviators-code-agent/releases).
2. In VS Code, run **Extensions: Install from VSIX...** from the Command Palette and select the downloaded file.
3. Reload VS Code if prompted.

You can also install it from a terminal:

```powershell
code --install-extension .\aviators-newsletter.vsix
```

## Configure the extension

Open VS Code Settings and search for **Aviators Newsletter**, or add settings to workspace/user `settings.json`.

| Setting | Default | Purpose |
|---|---|---|
| `aviators.output.folder` | `newsletters` | Workspace-relative directory for generated HTML. Absolute paths and `..` are rejected. |
| `aviators.playwright.headless` | `true` | Adds `--headless` to the runtime Playwright MCP server. |
| `aviators.playwright.mcpCommand` | Docker command shown below | Executable and arguments used for the Playwright stdio MCP server. |
| `aviators.email.mcpEndpoint` | empty | EmailCompanion HTTPS MCP endpoint. HTTP is allowed only on `localhost`, `127.0.0.1`, or `::1`. |
| `aviators.maxToolRounds` | `12` | Maximum model tool-call rounds per request (1-50). |
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

## Use `@aviators`

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

The participant reconstructs prior user and assistant text from the current chat, injects the contents of explicitly referenced text files, and has private read-only tools to list, read, and search files in the open workspace. Workspace tools cannot access paths outside the workspace and do not modify files.

### Language-model tools

The extension contributes and registers nine tools:

| Tool reference | Registered name | Role |
|---|---|---|
| `computeDateWindow` | `aviators_computeDateWindow` | Calculate the PST/PDT newsletter date window. |
| `createAceAviator` | `aviators_createAceAviator` | Generate Ace Aviator section HTML from supplied email/Q&A data. |
| `createProductGroupNews` | `aviators_createProductGroupNews` | Generate Product Group section HTML from real posts. |
| `createCommunityNews` | `aviators_createCommunityNews` | Generate one escaped Community batch for trusted participant-side accumulation. |
| `getEmailFromMCP` | `getEmailFromMCP` | Retrieve the Ace Aviator source email through EmailCompanion MCP. |
| `scrapeLinkedIn` | `aviators_scrapeLinkedIn` | Visit LinkedIn activity URLs in batches through Playwright MCP. |
| `resolveRedirects` | `aviators_resolveRedirects` | Resolve supplied URLs through Playwright MCP. |
| `playwright_navigate` | `playwright_navigate` | Visit linked external pages and return their content through Playwright MCP. |
| `getTechCommunityBlogPosts` | `aviators_getTechCommunityBlogPosts` | Fetch and date-filter Integration on Azure blog posts through Playwright MCP. |

Network tools can display VS Code confirmation prompts before visiting supplied URLs.

## Workspace HTML output

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
| `.\scripts\build-vsix.ps1 -Version 0.1.1` | Validate and build `release/aviators-newsletter-0.1.1.vsix` with a temporary version override; restores `package.json` and `package-lock.json` afterward. |

To run one compiled test:

```powershell
npm run test:compile
node .\out\test\aceAviator.test.js
```

Tagged releases use the `v*` tag as the temporary extension version, run lint and tests, and attach `aviators-newsletter-<version>.vsix` to the GitHub release. For example, pushing `v0.1.2` packages version `0.1.2` without requiring the committed `package.json` version to be changed first.

See [ARCHITECTURE.md](ARCHITECTURE.md) for component and data-flow details.

## License

MIT
