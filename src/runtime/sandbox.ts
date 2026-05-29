import {
  type Backend,
  type BackendInput,
  resolveBackend
} from "./backend";

export type MessageListener = (msg: any) => void;

/**
 * The bridge handed to the `exposed` factory. Lets the exposed API hook into
 * incoming messages and (re)start the VM job loop after async work resolves.
 */
export type SandboxBridge = {
  messages: {
    on: (e: MessageListener) => void;
    off: (e: MessageListener) => void;
    once: (e: MessageListener) => void;
  };
  startEventLoop: () => void;
};

export type Exposed =
  | ((bridge: SandboxBridge) => Record<string, any>)
  | Record<string, any>;

export type SandboxOptions = {
  /** Plugin source to evaluate. Provide either `code` or `src`. */
  code?: string;
  /** URL to fetch plugin source from. */
  src?: string;
  /**
   * The execution backend (or a factory for one). Required — choose one
   * explicitly, e.g. `quickjs()` for a QuickJS (WASM) VM. Backend-specific
   * options (WASM module override, marshaling rules) live on the backend
   * factory, e.g. `quickjs({ isMarshalable: "json" })`.
   */
  backend: BackendInput;
  /** API object (or factory) injected as globals into the VM. */
  exposed?: Exposed;
  /**
   * Trusted source evaluated in the VM *before* the plugin code. Used to
   * install host-provided runtimes (e.g. the JSX layer) as VM globals. Its
   * language matches the backend's `language`.
   */
  bootstrap?: string;
  onError?: (err: any) => void;
  onPreInit?: () => void;
  onDispose?: () => void;
  onMessage?: (msg: any) => void;
};

const defaultOnError = (err: any) => {
  console.error("zushi plugin error", err);
};

/**
 * Backend-agnostic host that evaluates untrusted plugin code with a
 * host-defined API exposed into it. It owns source fetching, message fan-out,
 * the event-loop scheduling and error handling, and drives the {@link Backend}
 * supplied via options for everything VM-specific. Knows nothing about iframes
 * or any particular UI — those are supplied through `exposed`.
 */
export class Sandbox {
  private options: SandboxOptions;
  private onError: (err: any) => void;
  private backendRef: Backend | undefined;
  private eventLoopTimer: number | undefined;
  private _loaded = false;
  private disposed = false;

  private messageListeners = new Set<MessageListener>();
  private messageOnceListeners = new Set<MessageListener>();

  constructor(options: SandboxOptions) {
    this.options = options;
    this.onError = options.onError ?? defaultOnError;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  /** The live backend, available after {@link start}. Advanced escape hatch. */
  backend(): Backend | undefined {
    return this.backendRef;
  }

  /**
   * Schedules the VM job loop. Call after resolving host-side async work so
   * the VM can run microtasks/promise continuations that depend on it.
   */
  requestEventLoop(): void {
    this.startEventLoop();
  }

  /** Fan out a message (e.g. from an iframe) to plugin-registered listeners. */
  handleMessage(msg: any): void {
    try {
      this.messageListeners.forEach((e) => e(msg));
      this.messageOnceListeners.forEach((e) => e(msg));
    } catch (e) {
      this.onError(e);
    }
    this.options.onMessage?.(msg);
    this.messageOnceListeners.clear();
  }

  /** Initialize the backend, expose the host API, and evaluate the plugin code. */
  async start(): Promise<void> {
    if (this.disposed) return;
    const { src, code: rawCode, exposed } = this.options;
    const code = rawCode ?? (src ? await (await fetch(src)).text() : "");
    if (!code || this.disposed) return;

    this.options.onPreInit?.();

    const backend = resolveBackend(this.options.backend);
    await backend.init();
    if (this.disposed) {
      backend.dispose();
      return;
    }
    this.backendRef = backend;

    const bridge: SandboxBridge = {
      messages: {
        on: (e) => this.messageListeners.add(e),
        off: (e) => this.messageListeners.delete(e),
        once: (e) => this.messageOnceListeners.add(e)
      },
      startEventLoop: () => this.startEventLoop()
    };

    const e = typeof exposed === "function" ? exposed(bridge) : exposed;
    if (e) backend.expose(e);

    if (this.options.bootstrap) this.evalCode(this.options.bootstrap);
    this.evalCode(code);
    this._loaded = true;
  }

  private evalCode(code: string): void {
    if (!this.backendRef) return;
    try {
      this.backendRef.eval(code);
    } catch (err) {
      this.onError(err);
    }
    this.startEventLoop();
  }

  private startEventLoop(): void {
    this.eventLoopTimer = (
      globalThis.setTimeout as Window["setTimeout"]
    )(() => this.runEventLoop(), 0);
  }

  private runEventLoop(): void {
    if (!this.backendRef) return;
    try {
      if (this.backendRef.pump()) {
        this.eventLoopTimer = (
          globalThis.setTimeout as Window["setTimeout"]
        )(() => this.runEventLoop(), 0);
      }
    } catch (err) {
      this.onError(err);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.onDispose?.();
    this.messageListeners.clear();
    this.messageOnceListeners.clear();
    this._loaded = false;
    if (typeof this.eventLoopTimer === "number") {
      clearTimeout(this.eventLoopTimer);
    }
    if (this.backendRef) {
      this.backendRef.dispose();
      this.backendRef = undefined;
    }
  }
}
