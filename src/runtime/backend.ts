/**
 * A pluggable execution runtime for plugin code. {@link Sandbox} owns the
 * backend-agnostic concerns (source fetching, message fan-out, event-loop
 * scheduling, error handling) and drives a `Backend` for everything that
 * depends on the underlying VM.
 *
 * QuickJS (see {@link ./quickjs}) is the default backend. Other guest languages
 * — e.g. a Python WASM runtime — can implement this same interface; the only
 * backend-agnostic constraint is the {@link Backend.language} tag, which gates
 * language-specific host features (the JSX layer requires `"js"`).
 */
export interface Backend {
  /** Human-readable label for diagnostics (e.g. `"quickjs"`). */
  readonly name: string;
  /**
   * Guest language tag. Used by the host to gate language-specific features —
   * the opt-in JSX runtime, for instance, is JS source and requires `"js"`.
   */
  readonly language: "js" | "python" | (string & {});

  /**
   * Initialize the underlying VM/runtime. Called once before any
   * {@link expose} or {@link eval}. May be async (WASM instantiation, etc.).
   */
  init(): Promise<void>;

  /**
   * Make a host API object reachable from guest code. The backend decides how
   * names and values are marshaled into its world.
   */
  expose(api: Record<string, any>): void;

  /**
   * Evaluate guest source. Used for both the trusted `bootstrap` and the plugin
   * code; the source language matches {@link language}. Throws on evaluation
   * error — the host catches and routes to its `onError`.
   */
  eval(code: string): void;

  /**
   * Drain one turn of queued async work (microtasks / promise jobs). Returns
   * `true` if work remains and the host should schedule another turn. Backends
   * with no manual job loop return `false`.
   */
  pump(): boolean;

  dispose(): void;
}

/** Lazily constructs a {@link Backend}; lets options be captured up front. */
export type BackendFactory = () => Backend;

/** What {@link Sandbox}/`Plugin` accept for their `backend` option. */
export type BackendInput = Backend | BackendFactory;

/** Resolve a {@link BackendInput} to a concrete {@link Backend}. */
export function resolveBackend(input: BackendInput): Backend {
  return typeof input === "function" ? input() : input;
}
