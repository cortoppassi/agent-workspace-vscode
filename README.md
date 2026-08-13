# Agent Workspace

Agent Workspace is a small VS Code extension for creating and managing multiple CLI coding agents in one project. Each agent has its own instructions file, working directory, terminal, and persisted project configuration.

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
5. Click the agent to start it. A terminal named `Backend` runs the local `codex` executable.
6. Create more agents and verify that each has independent instructions, terminal, and status.
7. Use the item actions or context menu to focus, stop, restart, edit, open instructions, or delete an agent.

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
