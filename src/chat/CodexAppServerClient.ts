import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { parseJsonRpcLine, type JsonRpcId, type JsonRpcMessage } from './protocol';
import { resolveCodexExecutable } from './resolveCodexExecutable';

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

type NotificationListener = (message: JsonRpcMessage) => void;
type ServerRequestHandler = (message: JsonRpcMessage) => Promise<unknown>;

export class CodexAppServerClient {
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly listeners = new Set<NotificationListener>();
  private process: ChildProcessWithoutNullStreams | undefined;
  private lines: ReadlineInterface | undefined;
  private startPromise: Promise<void> | undefined;
  private nextRequestId = 1;
  private disposed = false;

  public constructor(
    private readonly log: (message: string) => void,
    private readonly handleServerRequest: ServerRequestHandler,
  ) {}

  public onNotification(listener: NotificationListener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public async request<T>(method: string, params: unknown): Promise<T> {
    await this.start();
    const id = this.nextRequestId++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.write({ method, id, params });
    return (await result) as T;
  }

  public async start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.startInternal().catch((error: unknown) => {
        this.startPromise = undefined;
        throw error;
      });
    }
    return this.startPromise;
  }

  public dispose(): void {
    this.disposed = true;
    this.lines?.close();
    this.process?.kill();
    this.process = undefined;
    this.rejectPending(new Error('Codex App Server was stopped.'));
    this.listeners.clear();
  }

  private async startInternal(): Promise<void> {
    if (this.disposed) {
      throw new Error('Codex App Server client is disposed.');
    }
    const executable = resolveCodexExecutable();
    if (!executable) {
      throw new Error('Codex CLI was not found. Install it and restart VS Code before opening the chat.');
    }
    const child = spawn(executable.command, [...executable.argsPrefix, 'app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: executable.windowsVerbatimArguments,
    });
    this.process = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', (line) => this.receive(line));
    child.stderr.on('data', (chunk: Buffer) => this.log(`[app-server] ${chunk.toString().trimEnd()}`));
    child.on('error', (error) => this.fail(error));
    child.on('exit', (code, signal) => {
      if (!this.disposed) {
        this.fail(new Error(`Codex App Server exited (${code ?? signal ?? 'unknown'}).`));
      }
    });

    await this.requestDirect('initialize', {
      clientInfo: { name: 'agent_workspace', title: 'Agent Workspace', version: '0.1.0' },
      capabilities: null,
    });
    this.write({ method: 'initialized', params: {} });
  }

  private async requestDirect(method: string, params: unknown): Promise<unknown> {
    const id = this.nextRequestId++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.write({ method, id, params });
    return result;
  }

  private receive(line: string): void {
    const message = parseJsonRpcLine(line);
    if (!message) {
      this.log(`[app-server] Ignored invalid JSONL: ${line}`);
      return;
    }
    if (message.id !== undefined && message.method) {
      void this.respondToServerRequest(message);
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? `App Server error ${String(message.error.code ?? '')}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method) {
      for (const listener of this.listeners) {
        listener(message);
      }
    }
  }

  private async respondToServerRequest(message: JsonRpcMessage): Promise<void> {
    try {
      const result = await this.handleServerRequest(message);
      this.write({ id: message.id, result });
    } catch (error: unknown) {
      const details = error instanceof Error ? error.message : String(error);
      this.write({ id: message.id, error: { code: -32000, message: details } });
    }
  }

  private write(message: Record<string, unknown>): void {
    if (!this.process?.stdin.writable) {
      throw new Error('Codex App Server is not available.');
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private fail(error: Error): void {
    this.log(`[app-server] ${error.message}`);
    this.rejectPending(error);
    this.process = undefined;
    this.startPromise = undefined;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
