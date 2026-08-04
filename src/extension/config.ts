import * as vscode from "vscode";

export const EMAIL_API_KEY_SECRET = "aviators.email.apiKey";
export const MIN_TOOL_ROUNDS = 1;
export const MAX_TOOL_ROUNDS = 50;

const DEFAULT_OUTPUT_FOLDER = "newsletters";
const DEFAULT_MAX_TOOL_ROUNDS = 12;
const DEFAULT_PLAYWRIGHT_MCP_COMMAND: PlaywrightMcpCommand = {
  command: "docker",
  args: ["run", "-i", "--rm", "--init", "mcr.microsoft.com/playwright/mcp"]
};

export interface PlaywrightMcpCommand {
  command: string;
  args: string[];
}

export interface AviatorsConfiguration {
  outputFolder: string;
  playwrightHeadless: boolean;
  playwrightMcpCommand: PlaywrightMcpCommand;
  emailMcpEndpoint: string;
  maxToolRounds: number;
  enableMcpProvider: boolean;
}

function getConfiguration(resource?: vscode.Uri): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("aviators", resource);
}

export function getOutputFolder(resource?: vscode.Uri): string {
  const value = getConfiguration(resource).get<string>("output.folder", DEFAULT_OUTPUT_FOLDER).trim();
  return value || DEFAULT_OUTPUT_FOLDER;
}

export function getPlaywrightHeadless(resource?: vscode.Uri): boolean {
  return getConfiguration(resource).get<boolean>("playwright.headless", true);
}

export function getPlaywrightMcpCommand(resource?: vscode.Uri): PlaywrightMcpCommand {
  const value = getConfiguration(resource).get<PlaywrightMcpCommand>(
    "playwright.mcpCommand",
    DEFAULT_PLAYWRIGHT_MCP_COMMAND
  );
  const command = typeof value?.command === "string" ? value.command.trim() : "";
  const args = Array.isArray(value?.args)
    ? value.args.filter((argument): argument is string => typeof argument === "string")
    : [];

  return command
    ? { command, args }
    : { command: DEFAULT_PLAYWRIGHT_MCP_COMMAND.command, args: [...DEFAULT_PLAYWRIGHT_MCP_COMMAND.args] };
}

export function getEmailMcpEndpoint(resource?: vscode.Uri): string {
  return getConfiguration(resource).get<string>("email.mcpEndpoint", "").trim();
}

export function getMaxToolRounds(resource?: vscode.Uri): number {
  const value = getConfiguration(resource).get<number>("maxToolRounds", DEFAULT_MAX_TOOL_ROUNDS);
  const rounded = Number.isFinite(value) ? Math.round(value) : DEFAULT_MAX_TOOL_ROUNDS;
  return Math.min(MAX_TOOL_ROUNDS, Math.max(MIN_TOOL_ROUNDS, rounded));
}

export function getEnableMcpProvider(resource?: vscode.Uri): boolean {
  return getConfiguration(resource).get<boolean>("newsletter.enableMcpProvider", true);
}

export function getAviatorsConfiguration(resource?: vscode.Uri): AviatorsConfiguration {
  return {
    outputFolder: getOutputFolder(resource),
    playwrightHeadless: getPlaywrightHeadless(resource),
    playwrightMcpCommand: getPlaywrightMcpCommand(resource),
    emailMcpEndpoint: getEmailMcpEndpoint(resource),
    maxToolRounds: getMaxToolRounds(resource),
    enableMcpProvider: getEnableMcpProvider(resource)
  };
}

export async function getEmailApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(EMAIL_API_KEY_SECRET);
}

export async function setEmailApiKey(secrets: vscode.SecretStorage, apiKey: string): Promise<void> {
  await secrets.store(EMAIL_API_KEY_SECRET, apiKey);
}

export async function deleteEmailApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(EMAIL_API_KEY_SECRET);
}
