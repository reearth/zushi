import {
  Sandbox,
  type SandboxBridge,
  type BackendInput,
  resolveBackend
} from "./runtime";
import { createConsole, UISurface } from "./ui";
import type { AutoResize } from "./iframe";
import { JsxHost, VM_RUNTIME_SOURCE, type IntrinsicsPolicy } from "./jsx";
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
   * The full JSX runtime is in scope (same globals plugin code sees):
   * `registerComponent`, `h`/`createElement`, `Fragment`, `render`, the hooks
   * (`useState`, `useReducer`, `useEffect`, `useLayoutEffect`, `useMemo`,
   * `useCallback`, `useRef`, `useId`, `createContext`, `useContext`), plus
   * `memo`, `ErrorBoundary` and `Suspense`. Requires {@link jsx}.
   */
  setup?: string;
  /**
   * Whether `registerComponent` stays reachable from plugin code. Off by
   * default: the global is removed once {@link setup} has run, so only the
   * trusted setup slot can register components (and thereby grant the
   * intrinsic-tag privilege). Set `true` to keep it exposed to plugin code.
   * Requires {@link jsx}.
   */
  exposeRegisterComponent?: boolean;
  /**
   * Gates plugin-authored intrinsic (HTML) tags: `true` (default, any), `false`
   * (none — plugins must use registered components), or an allowlist of tags.
   * Tags emitted inside registered components are always allowed. Requires
   * {@link jsx}.
   */
  intrinsics?: IntrinsicsPolicy;
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
 * wires them to the execution backend (QuickJS by default), and exposes a
 * default `{ console }` global merged
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
        intrinsics: options.intrinsics
      });
    }

    const bootstrap = options.jsx
      ? VM_RUNTIME_SOURCE +
        (options.setup ? "\n;" + options.setup : "") +
        (options.exposeRegisterComponent
          ? ""
          : "\n;delete globalThis.registerComponent;")
      : undefined;

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
        const base: Record<string, any> = { console: createConsole() };
        if (this.jsxHost) base.__zushi = this.jsxHost.bridge;
        const host =
          options.exposed?.({
            surfaces: this.surfaces,
            messages: bridge.messages,
            startEventLoop: bridge.startEventLoop
          }) ?? {};
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
