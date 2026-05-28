import { getQuickJS, type QuickJSWASMModule } from "quickjs-emscripten";
import { Arena } from "quickjs-emscripten-sync";

const AsyncFunction = (async () => {}).constructor;

/**
 * Restricts which host values may cross into the QuickJS VM. Only plain
 * objects, arrays, primitives, plain functions, Date and Promise are allowed
 * by default; class instances are rejected so plugin code cannot walk a
 * prototype chain back to host internals.
 */
export const defaultIsMarshalable = (obj: any): boolean => {
  return (
    ((typeof obj !== "object" || obj === null) && typeof obj !== "function") ||
    Array.isArray(obj) ||
    Object.getPrototypeOf(obj) === Function.prototype ||
    Object.getPrototypeOf(obj) === Object.prototype ||
    obj instanceof Date ||
    obj instanceof Promise ||
    obj instanceof AsyncFunction
  );
};

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
   * The QuickJS WASM module (or a promise for it). Defaults to `getQuickJS()`
   * (the release-sync wasmfile variant). Provide a different variant for
   * environments where a separate `.wasm` fetch is undesirable — e.g. a
   * singlefile variant for bundlers/browsers.
   */
  quickjs?: QuickJSWASMModule | Promise<QuickJSWASMModule>;
  /** Additional marshalability rule, OR'd with the default. */
  isMarshalable?: boolean | "json" | ((obj: any) => boolean | "json");
  /** API object (or factory) injected as globals into the VM. */
  exposed?: Exposed;
  /**
   * Trusted source evaluated in the VM *before* the plugin code. Used to
   * install host-provided runtimes (e.g. the JSX layer) as VM globals.
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
 * A QuickJS (WASM) VM that evaluates untrusted plugin code with a host-defined
 * API exposed into it. Framework-agnostic; it knows nothing about iframes or
 * any particular UI — those are supplied through `exposed`.
 */
export class Sandbox {
  private options: SandboxOptions;
  private onError: (err: any) => void;
  private arenaRef: Arena | undefined;
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

  arena(): Arena | undefined {
    return this.arenaRef;
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

  /** Initialize the VM, expose the host API, and evaluate the plugin code. */
  async start(): Promise<void> {
    if (this.disposed) return;
    const { src, code: rawCode, exposed, isMarshalable } = this.options;
    const code = rawCode ?? (src ? await (await fetch(src)).text() : "");
    if (!code || this.disposed) return;

    this.options.onPreInit?.();

    const mod = this.options.quickjs
      ? await this.options.quickjs
      : await getQuickJS();
    const ctx = mod.newContext();
    if (this.disposed) {
      ctx.dispose();
      return;
    }

    this.arenaRef = new Arena(ctx, {
      isMarshalable: (target) =>
        defaultIsMarshalable(target) ||
        (typeof isMarshalable === "function" ? isMarshalable(target) : "json"),
      experimentalContextEx: true
    });

    const bridge: SandboxBridge = {
      messages: {
        on: (e) => this.messageListeners.add(e),
        off: (e) => this.messageListeners.delete(e),
        once: (e) => this.messageOnceListeners.add(e)
      },
      startEventLoop: () => this.startEventLoop()
    };

    const e = typeof exposed === "function" ? exposed(bridge) : exposed;
    if (e) this.arenaRef.expose(e);

    if (this.options.bootstrap) this.evalCode(this.options.bootstrap);
    this.evalCode(code);
    this._loaded = true;
  }

  private evalCode(code: string): any {
    if (!this.arenaRef) return;
    let result: any;
    try {
      result = this.arenaRef.evalCode(code);
    } catch (err) {
      this.onError(err);
    }
    this.startEventLoop();
    return result;
  }

  private startEventLoop(): void {
    this.eventLoopTimer = (
      globalThis.setTimeout as Window["setTimeout"]
    )(() => this.runEventLoop(), 0);
  }

  private runEventLoop(): void {
    if (!this.arenaRef) return;
    try {
      this.arenaRef.executePendingJobs();
      if (this.arenaRef.context.runtime.hasPendingJob()) {
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
    if (this.arenaRef) {
      try {
        this.arenaRef.dispose();
        this.arenaRef.context.dispose();
      } catch (err) {
        console.debug("zushi: quickjs dispose error", err);
      } finally {
        this.arenaRef = undefined;
      }
    }
  }
}
