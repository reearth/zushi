import type {
  QuickJSContext,
  QuickJSWASMModule
} from "quickjs-emscripten";
import type { Arena } from "quickjs-emscripten-sync";

import type { Backend, BackendFactory } from "./backend";

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

export type QuickJSOptions = {
  /**
   * The QuickJS WASM module (or a promise for it). Defaults to `getQuickJS()`
   * (the release-sync wasmfile variant). Provide a different variant for
   * environments where a separate `.wasm` fetch is undesirable — e.g. a
   * singlefile variant for bundlers/browsers.
   */
  module?: QuickJSWASMModule | Promise<QuickJSWASMModule>;
  /**
   * Verdict for values the default rule rejects (class instances, …), OR'd with
   * the default. A function is consulted per value; a static `true` (live
   * proxy), `false` (not marshaled) or `"json"` (deep-copied snapshot) applies
   * to all of them. Defaults to `"json"`.
   */
  isMarshalable?: boolean | "json" | ((obj: any) => boolean | "json");
  /**
   * Wall-clock budget, in milliseconds, for a single {@link eval} or
   * {@link pump} turn. Plugin code is untrusted, so a runaway `while (1) {}`
   * (or an endlessly self-rescheduling promise chain) would otherwise freeze
   * the host tab — the VM is interrupted once a turn exceeds this budget.
   * Defaults to `5000`. Set to `0` (or a negative value) to disable.
   */
  maxExecutionMs?: number;
  /**
   * Upper bound on the number of queued promise jobs drained per {@link pump}
   * turn. Bounds a job that keeps enqueueing more jobs. Defaults to `10000`.
   */
  maxJobsPerPump?: number;
  /**
   * Hard cap on the VM heap, in bytes, passed to QuickJS'
   * `setMemoryLimit`. Guards against a plugin exhausting host memory. No limit
   * by default.
   */
  memoryLimitBytes?: number;
  /**
   * Maximum VM stack size, in bytes, passed to QuickJS' `setMaxStackSize`.
   * Bounds deep/infinite recursion in plugin code. Engine default if unset.
   */
  maxStackSizeBytes?: number;
};

const DEFAULT_MAX_EXECUTION_MS = 5000;
const DEFAULT_MAX_JOBS_PER_PUMP = 10000;

/**
 * A QuickJS (WASM) {@link Backend}. Evaluates untrusted JavaScript in an
 * isolated VM context and marshals a host-defined API into it via
 * `quickjs-emscripten-sync`'s {@link Arena}.
 */
export class QuickJSBackend implements Backend {
  readonly name = "quickjs";
  readonly language = "js";

  private options: QuickJSOptions;
  private arenaRef: Arena | undefined;
  // Absolute time (ms) the current eval/pump turn must finish by, read by the
  // interrupt handler. `undefined` while the VM is idle (no deadline enforced).
  private deadline: number | undefined;

  constructor(options: QuickJSOptions = {}) {
    this.options = options;
  }

  /** The live arena, available after {@link init}. Advanced escape hatch. */
  get arena(): Arena | undefined {
    return this.arenaRef;
  }

  /** The live VM context, available after {@link init}. Advanced escape hatch. */
  get context(): QuickJSContext | undefined {
    return this.arenaRef?.context;
  }

  async init(): Promise<void> {
    // Import the QuickJS engine and marshaling arena lazily so merely importing
    // zushi (e.g. `PluginView` from the React entry) doesn't eagerly pull the
    // ~95KB of emscripten glue + sync runtime — it loads only when a VM starts.
    const { Arena } = await import("quickjs-emscripten-sync");
    const mod = this.options.module
      ? await this.options.module
      : await (await import("quickjs-emscripten")).getQuickJS();
    const ctx = mod.newContext();

    const { memoryLimitBytes, maxStackSizeBytes } = this.options;
    const runtime = ctx.runtime;
    if (typeof memoryLimitBytes === "number") {
      runtime.setMemoryLimit(memoryLimitBytes);
    }
    if (typeof maxStackSizeBytes === "number") {
      runtime.setMaxStackSize(maxStackSizeBytes);
    }
    const maxExecutionMs = this.options.maxExecutionMs ?? DEFAULT_MAX_EXECUTION_MS;
    if (maxExecutionMs > 0) {
      // Fires periodically while the interpreter runs; interrupts (throwing an
      // InternalError into the VM) once the current turn has run past its
      // deadline. Idle turns leave `deadline` undefined, so nothing interrupts.
      runtime.setInterruptHandler(
        () => this.deadline !== undefined && Date.now() > this.deadline
      );
    }

    const { isMarshalable } = this.options;
    // Values the default rule rejects (class instances, …) fall back to this:
    // a custom function, an explicit static verdict, or a "json" snapshot.
    const fallback =
      typeof isMarshalable === "function"
        ? isMarshalable
        : () => (isMarshalable === undefined ? "json" : isMarshalable);

    this.arenaRef = new Arena(ctx, {
      isMarshalable: (target) => defaultIsMarshalable(target) || fallback(target),
      experimentalContextEx: true
    });
  }

  expose(api: Record<string, any>): void {
    this.arenaRef?.expose(api);
  }

  eval(code: string): void {
    if (!this.arenaRef) return;
    this.arm();
    try {
      this.arenaRef.evalCode(code);
    } finally {
      this.deadline = undefined;
    }
  }

  pump(): boolean {
    if (!this.arenaRef) return false;
    this.arm();
    try {
      this.arenaRef.executePendingJobs(
        this.options.maxJobsPerPump ?? DEFAULT_MAX_JOBS_PER_PUMP
      );
    } finally {
      this.deadline = undefined;
    }
    return this.arenaRef.context.runtime.hasPendingJob();
  }

  /** Arm the interrupt deadline for the turn that is about to run. */
  private arm(): void {
    const maxExecutionMs = this.options.maxExecutionMs ?? DEFAULT_MAX_EXECUTION_MS;
    this.deadline = maxExecutionMs > 0 ? Date.now() + maxExecutionMs : undefined;
  }

  dispose(): void {
    const arena = this.arenaRef;
    if (!arena) return;
    // Clear the ref first so a throw mid-dispose can't leave a half-disposed
    // arena reachable. Dispose the arena and the context independently — the
    // arena owns its marshaling maps, the context owns the VM — so a failure
    // in one still runs the other and never leaks the WASM context.
    this.arenaRef = undefined;
    try {
      arena.dispose();
    } catch (err) {
      console.debug("zushi: quickjs arena dispose error", err);
    }
    try {
      arena.context.dispose();
    } catch (err) {
      console.debug("zushi: quickjs context dispose error", err);
    }
  }
}

/** Build a QuickJS {@link Backend} factory for `Plugin`/`Sandbox`'s `backend` option. */
export const quickjs = (options?: QuickJSOptions): BackendFactory =>
  () => new QuickJSBackend(options);
