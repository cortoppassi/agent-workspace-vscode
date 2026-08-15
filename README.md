# Agent Workspace

Agent Workspace is a small VS Code extension for creating and managing multiple CLI coding agents in one project. Each agent has its own instructions file, working directory, chat or terminal session, and persisted project configuration.

The MVP supports the local Codex CLI and a generic Custom CLI escape hatch. It runs entirely on the developer's machine and does not include telemetry, authentication, cloud services, or an OpenAI API integration.

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
3. Enter `Backend`, choose `Codex`, and use `.` as the working directory.
4. Edit the newly opened `.agent-workspace/agents/backend.md` file.
5. Click the agent to open its current embedded conversation and send a message.
6. Expand the agent and select **New Conversation** to start another independent conversation.
7. Select a conversation from the list to reopen its history; use its context menu to rename or remove it.
8. Use the compact chat selectors to choose an available Codex model and reasoning effort for that conversation.
9. Expand **Details** below the chat to inspect that conversation's token usage; the agent row shows the combined total.
10. Use **Start** from the agent actions or context menu when you want an interactive terminal named `Backend`.
11. Create more agents and verify that each has independent instructions, conversations, terminal, and status.

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
