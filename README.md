# Agent Workspace

Agent Workspace is a local control plane for routing coding tasks to specialized CLI agents in one project. Each agent has its own specialties, instructions file, working directory, chat or terminal session, and persisted project configuration.

The MVP supports the local Codex CLI and a generic Custom CLI escape hatch. **Modo Economia** accepts a task directly in the global chat and asks an economical Codex model to choose between the configured agents from the user's intent, task complexity, complete agent instructions, specialties, model, and reasoning profile. It explains the AI decision and waits for confirmation before starting. The control plane uses the authenticated local Codex app-server and does not add telemetry, accounts, a backend, API keys, or a separate OpenAI API integration.

## Modo Economia

Use the toggle action in the **Agents** view to enter the global economy chat. While active, the Agents section is hidden so the chat uses the available space, and the active toggle moves to the Chat header. Turning it off restores the Agents section and the previously selected conversation. You do not select an agent before submitting an economy task. Agent Workspace then:

1. Reads the local profiles and complete instructions of available Codex agents.
2. Sends the task and those profiles to an isolated, read-only Codex analysis turn with a strict JSON output schema.
3. Lets the AI interpret the user's intent, classify complexity, and compare required capabilities with cost versus reliability.
4. Validates locally that the returned agent exists and uses the model and reasoning effort configured on that agent.
5. Explains which AI model made the routing decision before any conversation is created.
6. Records the accepted decision in the conversation for later inspection.

There is no keyword-scoring fallback. If the AI response is invalid or selects an unknown agent, the task is not dispatched and the user receives an error.

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
