import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, delimiter, join } from "node:path";

import * as vscode from "vscode";

import {
  createMcpInitializeParams,
  handleMcpServerMessage,
  type JsonRpcResponseMessage,
  type McpRoot
} from "../core/mcpClientProtocol";
import { isStorageValid } from "../core/mcpBridge";
import { getPlaywrightMcpCommand, type PlaywrightMcpCommand } from "./config";

const LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login";
const STORAGE_FILE_NAME = "storage.json";
const PROFILE_DIRECTORY_NAME = "linkedin-profile";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_STDERR_LENGTH = 8_192;

interface ToolCallResult {
  isError?: boolean;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

interface LaunchSpec {
  command: string;
  args: string[];
  usedPortableNpx: boolean;
}

export class LinkedInSessionCommands implements vscode.Disposable {
  private activeClient: StdioMcpClient | undefined;
  private signingIn = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async signIn(): Promise<void> {
    if (this.signingIn) {
      await vscode.window.showInformationMessage(
        "A LinkedIn sign-in window is already open."
      );
      return;
    }

    this.signingIn = true;
    let savedCookieCount: number | undefined;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Aviators: Starting LinkedIn sign-in",
          cancellable: true
        },
        async (progress, cancellationToken) => {
          const storageDirectory = this.context.globalStorageUri.fsPath;
          const storagePath = join(storageDirectory, STORAGE_FILE_NAME);
          const userDataDirectory = join(storageDirectory, PROFILE_DIRECTORY_NAME);
          const storageRoot: McpRoot = {
            uri: vscode.Uri.file(storageDirectory).toString(),
            name: "Aviators Newsletter global storage"
          };
          await mkdir(userDataDirectory, { recursive: true });

          const launch = createLoginLaunchSpec(
            getPlaywrightMcpCommand(),
            userDataDirectory
          );
          if (launch.usedPortableNpx) {
            progress.report({
              message: "Docker is headless-only; using the local npx Playwright MCP instead."
            });
          }

          const client = new StdioMcpClient(
            launch,
            storageDirectory,
            storageRoot
          );
          this.activeClient = client;
          const cancellation = cancellationToken.onCancellationRequested(() => {
            void client.dispose();
          });

          try {
            progress.report({ message: "Launching a headed browser..." });
            await client.start();
            await client.callTool("browser_navigate", { url: LINKEDIN_LOGIN_URL });

            while (!cancellationToken.isCancellationRequested) {
              const selection = await vscode.window.showInformationMessage(
                "Complete LinkedIn sign-in in the browser window, including any verification. Then return here to save the session.",
                { modal: true },
                "Save Session"
              );

              if (selection !== "Save Session") {
                return;
              }

              progress.report({ message: "Saving LinkedIn session..." });
              await client.callTool("browser_storage_state", {
                filename: STORAGE_FILE_NAME
              });

              const validation = isStorageValid(storagePath);
              if (validation.valid) {
                savedCookieCount = validation.cookieCount ?? 0;
                return;
              }

              const retry = await vscode.window.showWarningMessage(
                `The LinkedIn session was not valid: ${validation.reason ?? "unknown reason"}.`,
                { modal: true },
                "Try Again"
              );
              if (retry !== "Try Again") {
                return;
              }
            }
          } catch (error) {
            if (!cancellationToken.isCancellationRequested) {
              throw error;
            }
          } finally {
            cancellation.dispose();
            await client.closeBrowser();
            await client.dispose();
            if (this.activeClient === client) {
              this.activeClient = undefined;
            }
          }
        }
      );
      if (savedCookieCount !== undefined) {
        await vscode.window.showInformationMessage(
          `LinkedIn session saved (${savedCookieCount} LinkedIn cookies).`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(
        `LinkedIn sign-in could not be completed: ${message}`
      );
    } finally {
      this.signingIn = false;
    }
  }

  async checkStatus(): Promise<void> {
    const storagePath = vscode.Uri.joinPath(
      this.context.globalStorageUri,
      STORAGE_FILE_NAME
    ).fsPath;
    const validation = isStorageValid(storagePath);

    if (validation.valid) {
      await vscode.window.showInformationMessage(
        `LinkedIn session is available (${validation.cookieCount ?? 0} LinkedIn cookies).`
      );
      return;
    }

    const selection = await vscode.window.showWarningMessage(
      `LinkedIn session is not available: ${validation.reason ?? "unknown reason"}.`,
      "Sign In"
    );
    if (selection === "Sign In") {
      await vscode.commands.executeCommand("aviators.signInToLinkedIn");
    }
  }

  dispose(): void {
    void this.activeClient?.dispose();
  }
}

class StdioMcpClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextRequestId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private disposed = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(
    private readonly launch: LaunchSpec,
    private readonly workingDirectory: string,
    private readonly root: McpRoot
  ) {}

  async start(): Promise<void> {
    if (this.child) {
      throw new Error("The Playwright MCP process is already running.");
    }

    const child = spawn(this.launch.command, this.launch.args, {
      cwd: this.workingDirectory,
      env: process.env,
      windowsHide: false,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => this.handleStdout(data));
    child.stderr.on("data", (data: string) => {
      this.stderrBuffer = (this.stderrBuffer + data).slice(-MAX_STDERR_LENGTH);
    });
    child.on("error", (error) => this.rejectAll(error));
    child.on("exit", (code, signal) => {
      if (!this.disposed) {
        const detail = this.stderrBuffer.trim();
        const suffix = detail ? `\n${detail}` : "";
        this.rejectAll(
          new Error(
            `Playwright MCP exited unexpectedly (code ${code ?? "none"}, signal ${signal ?? "none"}).${suffix}`
          )
        );
      }
    });

    await this.request("initialize", createMcpInitializeParams());
    this.notify("notifications/initialized");
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = (await this.request("tools/call", {
      name,
      arguments: args
    })) as ToolCallResult;

    if (result?.isError) {
      const detail =
        result.content
          ?.filter((item) => item.type === "text" && item.text)
          .map((item) => item.text)
          .join("\n") || `Playwright MCP tool ${name} failed.`;
      throw new Error(detail);
    }

    return result;
  }

  async closeBrowser(): Promise<void> {
    if (!this.child || this.disposed) {
      return;
    }
    try {
      await this.callTool("browser_close", {});
    } catch {
      // Process cleanup below still closes the browser if the tool is unavailable.
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectAll(new Error("The Playwright MCP session was closed."));

    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    child.stdin.end();
    if (await waitForExit(child, 1_500)) {
      return;
    }

    await terminateProcessTree(child);
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    if (!child || this.disposed) {
      return Promise.reject(new Error("The Playwright MCP process is not running."));
    }

    const id = this.nextRequestId++;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const detail = this.stderrBuffer.trim();
        reject(
          new Error(
            `Playwright MCP timed out while handling ${method}.${detail ? `\n${detail}` : ""}`
          )
        );
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });

      child.stdin.write(`${payload}\n`, (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(id);
          pending.reject(error);
        }
      });
    });
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    const message: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params) {
      message.params = params;
    }
    this.writeMessage(message);
  }

  private handleStdout(data: string): void {
    this.stdoutBuffer += data;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trimEnd();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleMessage(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleMessage(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      return;
    }

    const handled = handleMcpServerMessage(message, [this.root]);
    if (handled.kind === "request") {
      this.writeMessage(handled.response);
      return;
    }
    if (handled.kind !== "response" || typeof handled.id !== "number") {
      return;
    }

    const pending = this.pending.get(handled.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(handled.id);

    if (handled.error) {
      pending.reject(new Error(handled.error.message));
    } else {
      pending.resolve(handled.result);
    }
  }

  private writeMessage(
    message: JsonRpcResponseMessage | Record<string, unknown>
  ): void {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function createLoginLaunchSpec(
  configured: PlaywrightMcpCommand,
  userDataDirectory: string
): LaunchSpec {
  const configuredCommandName = basename(configured.command).toLowerCase();
  const isDocker =
    configuredCommandName === "docker" || configuredCommandName === "docker.exe";
  const baseCommand = isDocker ? "npx" : configured.command;
  const baseArgs = isDocker
    ? ["--yes", "@playwright/mcp@latest"]
    : configured.args;
  const resolved = resolveNpxLaunch(baseCommand, baseArgs);

  return {
    command: resolved.command,
    args: buildLoginArguments(resolved.args, userDataDirectory),
    usedPortableNpx: isDocker
  };
}

function buildLoginArguments(args: string[], userDataDirectory: string): string[] {
  const result: string[] = [];
  const capabilities = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--headless" || argument === "--isolated") {
      continue;
    }
    if (
      argument === "--storage-state" ||
      argument === "--user-data-dir" ||
      argument === "--port" ||
      argument === "--snapshot-mode" ||
      argument === "--image-responses"
    ) {
      index += 1;
      continue;
    }
    if (
      argument.startsWith("--storage-state=") ||
      argument.startsWith("--user-data-dir=") ||
      argument.startsWith("--port=") ||
      argument.startsWith("--snapshot-mode=") ||
      argument.startsWith("--image-responses=")
    ) {
      continue;
    }
    if (argument === "--caps") {
      for (const capability of (args[index + 1] ?? "").split(",")) {
        if (capability) {
          capabilities.add(capability);
        }
      }
      index += 1;
      continue;
    }
    if (argument.startsWith("--caps=")) {
      for (const capability of argument.slice("--caps=".length).split(",")) {
        if (capability) {
          capabilities.add(capability);
        }
      }
      continue;
    }

    result.push(argument);
  }

  capabilities.add("storage");
  result.push(
    "--user-data-dir",
    userDataDirectory,
    `--caps=${[...capabilities].join(",")}`,
    "--snapshot-mode=none",
    "--image-responses=omit"
  );
  return result;
}

function resolveNpxLaunch(command: string, args: string[]): {
  command: string;
  args: string[];
} {
  const commandName = basename(command).toLowerCase();
  if (!["npx", "npx.cmd", "npx.ps1"].includes(commandName)) {
    if (
      process.platform === "win32" &&
      (commandName.endsWith(".cmd") || commandName.endsWith(".bat"))
    ) {
      throw new Error(
        "The configured Playwright MCP command is a Windows shell script. Configure an executable command, or use npx."
      );
    }
    return { command, args: [...args] };
  }

  if (process.platform !== "win32") {
    return { command, args: [...args] };
  }

  const npxDirectory = dirname(findOnPath(command, ["npx.cmd", "npx.ps1"]));
  const npxCli = join(npxDirectory, "node_modules", "npm", "bin", "npx-cli.js");
  const nodeExecutable = findOnPath("node", ["node.exe"]);
  if (!existsSync(npxCli)) {
    throw new Error(
      `Could not locate the npx CLI beside ${npxDirectory}. Install Node.js with npm or configure aviators.playwright.mcpCommand to an executable Playwright MCP command.`
    );
  }

  return {
    command: nodeExecutable,
    args: [npxCli, ...args]
  };
}

function findOnPath(command: string, candidates: string[]): string {
  if (command.includes("\\") || command.includes("/")) {
    if (existsSync(command)) {
      return command;
    }
    throw new Error(`Executable not found: ${command}`);
  }

  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) {
      continue;
    }
    for (const candidate of candidates) {
      const path = join(directory.replace(/^"|"$/g, ""), candidate);
      if (existsSync(path)) {
        return path;
      }
    }
  }

  throw new Error(
    `Could not find ${command} on PATH. Install Node.js with npm or configure aviators.playwright.mcpCommand.`
  );
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function terminateProcessTree(
  child: ChildProcessWithoutNullStreams
): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const terminator = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          windowsHide: true,
          shell: false,
          stdio: "ignore"
        }
      );
      terminator.once("error", () => resolve());
      terminator.once("exit", () => resolve());
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  if (!(await waitForExit(child, 1_500))) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}
