import * as vscode from "vscode";
import {
  deleteEmailApiKey,
  getEnableMcpProvider,
  getPlaywrightMcpCommand,
  setEmailApiKey
} from "./config";
import {
  AviatorsMcpServerDefinitionProvider,
  MCP_SERVER_DEFINITION_PROVIDER_ID
} from "./mcpProvider";
import { LinkedInSessionCommands } from "./linkedinSession";
import {
  APPLY_NEWSLETTER_CHANGES_COMMAND,
  DISCARD_NEWSLETTER_CHANGES_COMMAND,
  NEWSLETTER_PROPOSAL_SCHEME,
  NewsletterOutputManager,
  OPEN_NEWSLETTER_COMMAND,
  REVIEW_NEWSLETTER_CHANGES_COMMAND
} from "./output.js";
import {
  NEWSLETTER_PARTICIPANT_ID,
  NewsletterChatFollowupProvider,
  createNewsletterChatRequestHandler
} from "./participant.js";
import { registerNewsletterLanguageModelTools } from "./toolRegistry";
import { resolveLmToolName } from "./lmToolBridge";
import { NewsletterWorkflowRuntime, SHOW_WORKFLOW_STATUS_COMMAND } from "./workflowRuntime.js";

const CHECK_PLAYWRIGHT_MCP_STATUS_COMMAND =
  "aviators.checkPlaywrightMcpStatus";

export function activate(context: vscode.ExtensionContext): void {
  const mcpProvider = new AviatorsMcpServerDefinitionProvider(context);
  const linkedInSessionCommands = new LinkedInSessionCommands(context);
  const outputManager = new NewsletterOutputManager();
  const workflow = new NewsletterWorkflowRuntime(outputManager);
  const languageModelTools = registerNewsletterLanguageModelTools(workflow);
  const handler = createNewsletterChatRequestHandler(outputManager, workflow);

  const participant = vscode.chat.createChatParticipant(
    NEWSLETTER_PARTICIPANT_ID,
    handler
  );
  participant.followupProvider = new NewsletterChatFollowupProvider();
  const openNewsletterCommand = vscode.commands.registerCommand(
    OPEN_NEWSLETTER_COMMAND,
    async (uri?: unknown) => {
      try {
        await outputManager.openNewsletter(uri);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(message);
      }
    }
  );
  const reviewNewsletterChangesCommand = vscode.commands.registerCommand(
    REVIEW_NEWSLETTER_CHANGES_COMMAND,
    async (proposalId?: unknown) => {
      try {
        const selected = await outputManager.selectProposal(proposalId);
        if (selected) await outputManager.reviewProposal(selected);
      } catch (error) {
        await vscode.window.showErrorMessage(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );
  const applyNewsletterChangesCommand = vscode.commands.registerCommand(
    APPLY_NEWSLETTER_CHANGES_COMMAND,
    async (proposalId?: unknown) => {
      try {
        const selected = await outputManager.selectProposal(proposalId);
        if (!selected) return;
        const uri = await outputManager.applyProposal(selected);
        await vscode.window.showInformationMessage(
          `Applied and saved Aviators changes to ${uri.fsPath}.`
        );
      } catch (error) {
        await vscode.window.showErrorMessage(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );
  const discardNewsletterChangesCommand = vscode.commands.registerCommand(
    DISCARD_NEWSLETTER_CHANGES_COMMAND,
    async (proposalId?: unknown) => {
      try {
        const selected = await outputManager.selectProposal(proposalId);
        if (!selected) return;
        outputManager.discardProposal(selected);
        await vscode.window.showInformationMessage(
          "Discarded the proposed Aviators newsletter changes."
        );
      } catch (error) {
        await vscode.window.showErrorMessage(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );
  const proposalContentProvider =
    vscode.workspace.registerTextDocumentContentProvider(
      NEWSLETTER_PROPOSAL_SCHEME,
      outputManager
    );
  const workflowStatusCommand = vscode.commands.registerCommand(
    SHOW_WORKFLOW_STATUS_COMMAND,
    async (workflowId?: unknown) => {
      try { await workflow.showStatus(workflowId); }
      catch (error) {
        await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }
  );
  const setEmailApiKeyCommand = vscode.commands.registerCommand("aviators.setEmailApiKey", async () => {
    const apiKey = await vscode.window.showInputBox({
      title: "Aviators: Set Email API Key",
      prompt: "Enter the EmailCompanion API key, or leave blank to delete the stored key.",
      password: true,
      ignoreFocusOut: true
    });

    if (apiKey === undefined) {
      return;
    }

    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey) {
      await deleteEmailApiKey(context.secrets);
      await vscode.window.showInformationMessage("The Aviators Email API key was deleted.");
      return;
    }

    await setEmailApiKey(context.secrets, normalizedApiKey);
    await vscode.window.showInformationMessage("The Aviators Email API key was stored securely.");
  });
  const signInToLinkedInCommand = vscode.commands.registerCommand(
    "aviators.signInToLinkedIn",
    async () => {
      await linkedInSessionCommands.signIn();
      mcpProvider.refresh();
    }
  );
  const checkLinkedInSessionStatusCommand = vscode.commands.registerCommand(
    "aviators.checkLinkedInSessionStatus",
    () => linkedInSessionCommands.checkStatus()
  );
  const checkPlaywrightMcpStatusCommand = vscode.commands.registerCommand(
    CHECK_PLAYWRIGHT_MCP_STATUS_COMMAND,
    async () => {
      const configured = getPlaywrightMcpCommand();
      if (!getEnableMcpProvider()) {
        await vscode.window.showWarningMessage(
          "The Aviators MCP provider is disabled. Enable aviators.newsletter.enableMcpProvider or configure a separate trusted Playwright MCP server."
        );
        return;
      }

      try {
        const resolvedName = resolveLmToolName(
          "browser_navigate",
          vscode.lm.tools.map((tool) => tool.name)
        );
        await vscode.window.showInformationMessage(
          `Playwright MCP is available as "${resolvedName}". Configured Aviators command: ${formatCommand(configured.command, configured.args)}`
        );
      } catch {
        await vscode.window.showErrorMessage(
          `Playwright MCP tools have not been discovered. Configured Aviators command: ${formatCommand(configured.command, configured.args)}. Run "MCP: List Servers", start and trust Playwright, then use "Show Output".`
        );
      }
    }
  );

  context.subscriptions.push(
    participant,
    openNewsletterCommand,
    reviewNewsletterChangesCommand,
    applyNewsletterChangesCommand,
    discardNewsletterChangesCommand,
    proposalContentProvider,
    workflowStatusCommand,
    setEmailApiKeyCommand,
    signInToLinkedInCommand,
    checkLinkedInSessionStatusCommand,
    checkPlaywrightMcpStatusCommand,
    ...languageModelTools,
    linkedInSessionCommands,
    mcpProvider,
    vscode.lm.registerMcpServerDefinitionProvider(
      MCP_SERVER_DEFINITION_PROVIDER_ID,
      mcpProvider
    )
  );
}

export function deactivate(): void {}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(quoteCommandPart).join(" ");
}

function quoteCommandPart(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}
