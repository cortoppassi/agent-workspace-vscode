# Architecture

```text
Extension composition root
  ├─ TreeView ───────────────→ AgentManager
  ├─ Commands ───────────────→ AgentManager
  ├─ AgentManager ───────────→ ConfigManager
  └─ Commands ───────────────→ TerminalManager ──→ AgentProvider
```

`extension.ts` resolves the primary workspace once, creates the services, registers commands and the view, and owns disposal.

`AgentManager` owns the in-memory list and create/edit/delete rules. It generates safe IDs, prevents duplicates, validates the working directory, and asks `ConfigManager` to persist changes. It has no provider-specific behavior.

`ConfigManager` is the project filesystem boundary. It reads and atomically replaces `.agent-workspace/config.json`, creates instruction templates, resolves workspace-relative paths, and rejects paths outside the workspace. It does not create `.agent-workspace` until the first agent is created.

`AgentProvider` translates an agent into a terminal launch specification. `CodexProvider` uses a direct executable plus a separate prompt argument. This avoids shell interpolation and works with paths containing spaces on Windows, macOS, and Linux. `GenericCliProvider` sends the explicitly configured command to the user's normal shell.

`TerminalManager` exclusively owns `Map<agentId, Terminal>`. It starts, focuses, restarts, stops, and disposes terminals. The official `window.onDidCloseTerminal` event removes manually closed terminals and refreshes status. Only `Running` and `Stopped` are inferred.

`AgentTreeProvider` renders a flat native TreeView. It observes agent and terminal events; it does not mutate either subsystem.

The MVP intentionally resolves only the first workspace folder through `WorkspaceResolver`. Multi-root selection is a future extension point.
