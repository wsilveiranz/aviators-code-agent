import * as vscode from "vscode";
import { deleteEmailApiKey, setEmailApiKey } from "./config";
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

export function activate(context: vscode.ExtensionContext): void {
  const mcpProvider = new AviatorsMcpServerDefinitionProvider(context);
  const linkedInSessionCommands = new LinkedInSessionCommands(context);
  const outputManager = new NewsletterOutputManager();
  const languageModelTools = registerNewsletterLanguageModelTools();
  const handler = createNewsletterChatRequestHandler(outputManager);

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
        if (typeof proposalId !== "string") {
          throw new Error("The newsletter proposal identifier is invalid.");
        }
        await outputManager.reviewProposal(proposalId);
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
        if (typeof proposalId !== "string") {
          throw new Error("The newsletter proposal identifier is invalid.");
        }
        const uri = await outputManager.applyProposal(proposalId);
        await vscode.window.showInformationMessage(
          `Applied Aviators changes to ${uri.fsPath}.`
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
        if (typeof proposalId !== "string") {
          throw new Error("The newsletter proposal identifier is invalid.");
        }
        outputManager.discardProposal(proposalId);
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

  context.subscriptions.push(
    participant,
    openNewsletterCommand,
    reviewNewsletterChangesCommand,
    applyNewsletterChangesCommand,
    discardNewsletterChangesCommand,
    proposalContentProvider,
    setEmailApiKeyCommand,
    signInToLinkedInCommand,
    checkLinkedInSessionStatusCommand,
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
