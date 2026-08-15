# Agent Workspace

Agent Workspace is a local control plane for routing coding tasks to specialized CLI agents in one project. Each agent has its own specialties, instructions file, working directory, chat or terminal session, and persisted project configuration.

The MVP supports the local Codex CLI and a generic Custom CLI escape hatch. **Modo Economia** accepts a task directly in the global chat, ranks Codex agents from their specialties, instructions, model, and reasoning configuration, explains the automatic choice, and waits for confirmation before starting. It runs entirely on the developer's machine and does not include telemetry, authentication, cloud services, or an OpenAI API integration.

## Modo Economia

Use the sparkle action in the **Agents** view to open the global economy chat. You do not select an agent first. Agent Workspace then:

1. Reads the local profiles and instructions of available Codex agents.
2. Ranks agents by specialty, task-domain, and cost-versus-capability matches.
3. Classifies the task as simple, standard, or complex.
4. Uses the model and reasoning effort configured on each agent, shared by all of that agent's conversations.
5. Automatically chooses the strongest cost-effective route and explains it before any conversation is created.
6. Records the accepted decision in the conversation for later inspection.

This first control-plane increment routes one task to one confirmed agent. It does not yet run validation commands, automatically escalate failed work, or coordinate parallel writes.

## Development

Prerequisites: Node.js, npm, and VS Code.

```bash
npm install
npm run compile
```

Open this folder in VS Code and press `F5`. The `Run Agent Workspace` launch configuration builds the extension and opens an Extension Development Host.

## Manual test

In the Extension Development Host, open the project where agents should be configured, then:

1. Open **Agent Workspace** in the Activity Bar.
2. Select **Create Agent**.
3. Enter `Backend`, choose `Codex`, use `.` as the working directory, and add specialties such as `API, SQL, authentication`.
4. Edit the newly opened `.agent-workspace/agents/backend.md` file.
5. Click the agent to open its current embedded conversation and send a message.
6. Expand the agent and select **New Conversation** to start another independent conversation.
7. Select a conversation from the list to reopen its history; use its context menu to rename or remove it.
8. Use the compact chat selectors to choose the Codex model and reasoning effort for the agent; verify that another conversation for the same agent keeps the selection.
9. Expand **Details** below the chat to inspect that conversation's token usage; the agent row shows the combined total.
10. Use **Start** from the agent actions or context menu when you want an interactive terminal named `Backend`.
11. Create a second Codex agent with different specialties and model settings, select **Modo Economia**, and describe a task in the chat without choosing an agent.
12. Verify that the accepted decision appears above the new conversation and in its tree tooltip.

The extension assumes `codex` is installed, authenticated, and available on `PATH`.

## Project data

Configuration is shareable and uses workspace-relative paths:

```text
.agent-workspace/
├── config.json
└── agents/
    └── backend.md
```

No project data is sent anywhere. Custom CLI commands are intentionally executed exactly as configured by the user.

## Quality commands

```bash
npm run check-types
npm run lint
npm test
npm run compile
```

## Build a VSIX

```bash
npm run package
```

This creates a local `.vsix`; it does not publish the extension. Packaging follows the official [VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Current limitation

For multi-root workspaces, the MVP uses only the first workspace folder. Workspace resolution is centralized so multi-root support can be added without changing every module.
