import { existsSync, mkdirSync } from "node:fs";

import * as vscode from "vscode";
import {
  buildPlaywrightMcpArguments,
  validateEmailMcpEndpoint
} from "../core/mcpBridge";
import {
  EMAIL_API_KEY_SECRET,
  getEmailApiKey,
  getEmailMcpEndpoint,
  getEnableMcpProvider,
  getPlaywrightHeadless,
  getPlaywrightMcpCommand
} from "./config";

export const MCP_SERVER_DEFINITION_PROVIDER_ID = "aviators.newsletter";

const PLAYWRIGHT_LABEL = "Playwright";
const EMAIL_COMPANION_LABEL = "EmailCompanion";
const EMAIL_API_KEY_HEADER = "X-API-Key";

export class AviatorsMcpServerDefinitionProvider
  implements vscode.McpServerDefinitionProvider, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[];

  readonly onDidChangeMcpServerDefinitions = this.changeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("aviators.newsletter.enableMcpProvider") ||
          event.affectsConfiguration("aviators.playwright.headless") ||
          event.affectsConfiguration("aviators.playwright.mcpCommand") ||
          event.affectsConfiguration("aviators.email.mcpEndpoint")
        ) {
          this.changeEmitter.fire();
        }
      }),
      context.secrets.onDidChange((event) => {
        if (event.key === EMAIL_API_KEY_SECRET) {
          this.changeEmitter.fire();
        }
      })
    ];
  }

  provideMcpServerDefinitions(
    _token: vscode.CancellationToken
  ): vscode.McpServerDefinition[] {
    if (!getEnableMcpProvider()) {
      return [];
    }

    const playwrightCommand = getPlaywrightMcpCommand();
    const storageDirectory = this.context.globalStorageUri.fsPath;
    const storagePath = vscode.Uri.joinPath(
      this.context.globalStorageUri,
      "storage.json"
    ).fsPath;
    mkdirSync(storageDirectory, { recursive: true });
    const playwrightArgs = buildPlaywrightMcpArguments({
      ...playwrightCommand,
      storageDirectory,
      storagePath,
      storageExists: existsSync(storagePath),
      headless: getPlaywrightHeadless()
    });

    return [
      new vscode.McpStdioServerDefinition(
        PLAYWRIGHT_LABEL,
        playwrightCommand.command,
        playwrightArgs
      ),
      new vscode.McpHttpServerDefinition(
        EMAIL_COMPANION_LABEL,
        vscode.Uri.parse(getEmailMcpEndpoint())
      )
    ];
  }

  async resolveMcpServerDefinition(
    server: vscode.McpServerDefinition,
    _token: vscode.CancellationToken
  ): Promise<vscode.McpServerDefinition> {
    if (server.label === PLAYWRIGHT_LABEL) {
      if (!(server instanceof vscode.McpStdioServerDefinition) || !server.command.trim()) {
        throw new Error(
          "The Playwright MCP command is invalid. Configure aviators.playwright.mcpCommand."
        );
      }

      return server;
    }

    if (server.label === EMAIL_COMPANION_LABEL) {
      if (!(server instanceof vscode.McpHttpServerDefinition)) {
        throw new Error("The EmailCompanion MCP server definition is invalid.");
      }

      server.uri = parseEmailMcpEndpoint(getEmailMcpEndpoint());

      const apiKey = (await getEmailApiKey(this.context.secrets))?.trim();
      if (!apiKey) {
        throw new Error(
          "No EmailCompanion API key is configured. Run the “Aviators: Set Email API Key” command."
        );
      }

      server.headers = { [EMAIL_API_KEY_HEADER]: apiKey };
      return server;
    }

    throw new Error(`Unknown Aviators MCP server definition: ${server.label}`);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
  }

  refresh(): void {
    this.changeEmitter.fire();
  }
}

function parseEmailMcpEndpoint(endpoint: string): vscode.Uri {
  return vscode.Uri.parse(validateEmailMcpEndpoint(endpoint).toString());
}
