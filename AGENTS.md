# Agent Workspace contributor instructions

## Goal

Keep the smallest functional local control plane that routes a coding task to one qualified CLI agent, recommends a cost-conscious model setup, and explains the decision before execution.

## Architecture

- `extension.ts`: composition root and activation.
- `AgentManager`: agent lifecycle and persisted model.
- `ConfigManager`: `.agent-workspace` filesystem boundary.
- `AgentProvider` implementations: launch intent, independent of terminal lifecycle.
- `TerminalManager`: one VS Code terminal per running agent.
- `AgentTreeProvider`: native Activity Bar TreeView presentation.
- `TaskRouter`: deterministic local task classification and explainable route ranking.
- `commands`: VS Code input flows and user-facing error boundary.

## Commands

Run `npm run check-types`, `npm run lint`, `npm test`, and `npm run compile` before finishing. Use `npm run package` to produce a VSIX.

## Rules

- TypeScript strict mode; do not use `any`.
- Prefer small diffs and native VS Code APIs; do not add a WebView without a demonstrated need.
- Keep workspace paths relative and inside the primary workspace folder.
- Never expose technical exceptions directly to users.
- Dispose commands, views, event emitters, and terminals correctly.
- Add providers behind `AgentProvider`; do not couple agent management to a CLI.
- Do not read `.env`, store credentials, add telemetry, or transmit project data.

## Out of scope

Cloud/backend, accounts, billing, analytics, custom terminal output parsing, automatic multi-agent execution, parallel writes, MCP, Git worktrees, automatic branches/PRs/merges, and SDK/API integrations are not part of this MVP.
