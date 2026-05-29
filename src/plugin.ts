import {
  Sandbox,
  type SandboxBridge,
  type BackendInput,
  resolveBackend
} from "./runtime";
import { createConsole, UISurface } from "./ui";
import type { AutoResize } from "./iframe";
import {
  JsxHost,
  VM_RUNTIME_SOURCE,
  makeRuntimeRefs,
  extractPlacements,
  type RuntimeRefs,
  type IntrinsicsPolicy,
  type RuntimeNamespace,
  type AnyRenderer
} from "./jsx";
import { merge } from "./utils/merge";

/** Configuration for a single named UI surface. */
export type SurfaceConfig = {
  /**
   * Element the surface's iframe mounts into. If omitted, a hidden container is
   * created in `<body>` (useful for off-screen surfaces like modals).
   */
  container?: HTMLElement;
  /** Auto-resize behavior for this surface's iframe. */
  autoResize?: AutoResize;
  /** Initial visibility (default `true`). */
  visible?: boolean;
};

/**
 * Context passed to the host `exposed` factory. Surfaces are not auto-exposed
 * into the VM — the host wires them up here under whatever names it likes
 * (e.g. `reearth.ui = surfaces.main.api`), merged alongside the built-in
 * `console`.
 */
export type PluginContext = SandboxBridge & {
  /** The surfaces declared via {@link PluginOptions.surfaces}, keyed by name. */
  surfaces: Record<string, UISurface>;
  /**
   * Placement tokens for the JSX runtime API (requires {@link PluginOptions.jsx}).
   * Drop any of these into the returned tree to plant that runtime function at
   * that path in plugin scope, e.g. `reearth: { useState: runtime.useState }`
   * exposes `reearth.useState`. Tokens never reach the VM — zushi resolves them
   * to the real in-VM functions. Placing any token overrides the default
   * {@link PluginOptions.namespace} placement.
   */
  runtime: RuntimeRefs;
};

export type PluginOptions = {
  /** Plugin source to evaluate. Provide either `code` or `src`. */
  code?: string;
  /** URL to fetch plugin source from. */
  src?: string;
  /**
   * The named UI surfaces to create. None are created by default — the host
   * declares exactly the surfaces it needs and exposes them via {@link exposed}.
   */
  surfaces?: Record<string, SurfaceConfig>;
  /**
   * Opt in to the JSX UI runtime. When enabled, `createElement`/`Fragment`,
   * hooks (`useState`, `useEffect`, ...) and a `render()` global are installed
   * in the VM, and `render(<App/>, { surface })` drives a surface's iframe
   * declaratively. Off by default; the plain `surface.show(html)` path is
   * unaffected.
   */
  jsx?: boolean;
  /**
   * Trusted JS source, evaluated in the VM after the JSX runtime and before the
   * plugin. This is the *trusted setup slot*: its sole privilege over plugin
   * code is timing — components registered here via `registerComponent(name, fn)`
   * (à la Figma's `View`/`Text`) become trusted, so the markup they emit may use
   * intrinsic tags even when {@link intrinsics} forbids them in plugin code.
   *
   * The full JSX runtime is in scope here as bare names — `registerComponent`,
   * `h`/`createElement`, `Fragment`, `render`, the hooks (`useState`,
   * `useReducer`, `useEffect`, `useLayoutEffect`, `useMemo`, `useCallback`,
   * `useRef`, `useId`, `createContext`, `useContext`), plus `memo`,
   * `ErrorBoundary` and `Suspense` — regardless of where {@link namespace}
   * placed them for plugin code. (It is run inside `with (__zushi.runtime)`.)
   * The bundle is also reachable as `__zushi.runtime` for explicit wiring.
   * Requires {@link jsx}.
   */
  setup?: string;
  /**
   * Where the JSX runtime API is planted for plugin code when the host does not
   * place it explicitly via `runtime` refs (see {@link PluginContext.runtime}):
   * a namespace object name (default `"zushi"` → `zushi.useState`, …) or
   * `false` for bare globals. Ignored once any `runtime` ref is placed. Requires
   * {@link jsx}.
   */
  namespace?: RuntimeNamespace;
  /**
   * Whether `registerComponent` is included in the default {@link namespace}
   * placement. Off by default: only the trusted {@link setup} slot reaches it
   * (via the runtime bundle), so plugin code cannot register components (and
   * thereby grant itself the intrinsic-tag privilege). Requires {@link jsx}.
   */
  exposeRegisterComponent?: boolean;
  /**
   * Whether the host bridge `__zushi` stays reachable from plugin code. Off by
   * default: it is deleted from the VM global scope after {@link setup} runs, so
   * plugin code cannot reach the host render/dispatch internals. The runtime
   * functions keep working (they capture the bridge in a closure). Requires
   * {@link jsx}.
   */
  exposeBridge?: boolean;
  /**
   * Gates plugin-authored intrinsic (HTML) tags: `true` (default, any), `false`
   * (none — plugins must use registered components), or an allowlist of tags.
   * Tags emitted inside registered components are always allowed. Requires
   * {@link jsx}.
   */
  intrinsics?: IntrinsicsPolicy;
  /**
   * The renderer each surface uses. Defaults to the built-in `domRenderer`
   * (HTML DOM in a sandboxed iframe). Supply an iframe `Renderer` (e.g. from
   * `reactRenderer`) or a host-direct `HostRenderer` (e.g. from
   * `hostReactRenderer`, for canvas libraries — no iframe) to draw something
   * other than DOM; set {@link intrinsics} to that renderer's tag vocabulary.
   * Requires {@link jsx}.
   */
  renderer?: AnyRenderer;
  /** Builds the host-specific API merged into the exposed globals. */
  exposed?: (ctx: PluginContext) => Record<string, any>;
  /**
   * The execution backend (or a factory for one). Required — choose one
   * explicitly, e.g. `quickjs()` for a QuickJS (WASM) VM. Backend-specific
   * options (WASM module override, marshaling rules) live on the factory, e.g.
   * `backend: quickjs({ isMarshalable: "json" })`. Note: {@link jsx} requires a
   * JavaScript backend (`language === "js"`).
   */
  backend: BackendInput;
  onError?: (err: any) => void;
  onPreInit?: () => void;
  onDispose?: () => void;
  onMessage?: (msg: any) => void;
};

/**
 * High-level orchestrator: creates the host-declared sandboxed UI surfaces,
 * wires them to the chosen execution backend (QuickJS is built in), and exposes
 * a default `{ console }` global merged
 * with any host-provided API. Surfaces are handed to the host via the `exposed`
 * factory rather than auto-exposed.
 */
export class Plugin {
  readonly surfaces: Record<string, UISurface> = {};
  readonly sandbox: Sandbox;

  private ownedContainers: HTMLElement[] = [];
  private jsxHost?: JsxHost;

  constructor(options: PluginOptions) {
    const backend = resolveBackend(options.backend);
    if (options.jsx && backend.language !== "js") {
      throw new Error(
        `zushi: the jsx runtime requires a JavaScript backend, but "${backend.name}" is "${backend.language}"`
      );
    }

    const startEventLoop = () => this.sandbox?.requestEventLoop();

    const configs = options.surfaces ?? {};
    for (const name of Object.keys(configs)) {
      const cfg = configs[name];
      this.surfaces[name] = new UISurface({
        container: cfg.container ?? this.createContainer(),
        autoResize: cfg.autoResize,
        visible: cfg.visible ?? true,
        startEventLoop,
        onProtocolMessage: (data) => this.jsxHost?.handle(name, data) ?? false
      });
    }

    if (options.jsx) {
      this.jsxHost = new JsxHost({
        surfaces: this.surfaces,
        intrinsics: options.intrinsics,
        renderer: options.renderer,
        startEventLoop,
        namespace: options.namespace,
        exposeRegisterComponent: options.exposeRegisterComponent
      });
    }

    // When JSX is on, the runtime bundle lands on `__zushi.runtime`. `setup`
    // runs with it in scope (bare names); afterwards the bridge is sealed off
    // from plugin code unless `exposeBridge` is set.
    const bootstrap = options.jsx
      ? VM_RUNTIME_SOURCE +
        (options.setup
          ? "\n;with(globalThis.__zushi.runtime){\n" + options.setup + "\n}"
          : "") +
        (options.exposeBridge ? "" : "\n;delete globalThis.__zushi;")
      : undefined;

    // One ref token per runtime API; handed to `exposed` so the host can place
    // them anywhere in its tree.
    const runtime = makeRuntimeRefs();

    this.sandbox = new Sandbox({
      code: options.code,
      src: options.src,
      backend,
      bootstrap,
      onError: options.onError,
      onPreInit: options.onPreInit,
      onDispose: options.onDispose,
      onMessage: options.onMessage,
      exposed: (bridge) => {
        const host =
          options.exposed?.({
            surfaces: this.surfaces,
            messages: bridge.messages,
            startEventLoop: bridge.startEventLoop,
            runtime
          }) ?? {};
        // Pull any placed runtime refs out of the host tree (they must not be
        // marshaled) and tell the VM runtime where to install them — before the
        // `__zushi` bridge snapshots its config below.
        this.jsxHost?.setPlacements(extractPlacements(host));
        const base: Record<string, any> = { console: createConsole() };
        if (this.jsxHost) base.__zushi = this.jsxHost.bridge;
        return merge(base, host);
      }
    });
  }

  /** Initialize the VM and run the plugin. */
  start(): Promise<void> {
    return this.sandbox.start();
  }

  /** Forward an external message to plugin message listeners. */
  handleMessage(msg: any): void {
    this.sandbox.handleMessage(msg);
  }

  dispose(): void {
    this.sandbox.dispose();
    this.jsxHost?.dispose();
    for (const name of Object.keys(this.surfaces)) this.surfaces[name].dispose();
    for (const c of this.ownedContainers) c.remove();
    this.ownedContainers = [];
  }

  private createContainer(): HTMLElement {
    const el = document.createElement("div");
    el.style.display = "none";
    document.body.appendChild(el);
    this.ownedContainers.push(el);
    return el;
  }
}
