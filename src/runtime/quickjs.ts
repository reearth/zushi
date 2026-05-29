import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSWASMModule
} from "quickjs-emscripten";
import { Arena } from "quickjs-emscripten-sync";

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
};

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
    const mod = this.options.module
      ? await this.options.module
      : await getQuickJS();
    const ctx = mod.newContext();

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
    this.arenaRef?.evalCode(code);
  }

  pump(): boolean {
    if (!this.arenaRef) return false;
    this.arenaRef.executePendingJobs();
    return this.arenaRef.context.runtime.hasPendingJob();
  }

  dispose(): void {
    if (!this.arenaRef) return;
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

/** Build a QuickJS {@link Backend} factory for `Plugin`/`Sandbox`'s `backend` option. */
export const quickjs = (options?: QuickJSOptions): BackendFactory =>
  () => new QuickJSBackend(options);
