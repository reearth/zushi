import { Sandbox, type SandboxBridge, type SandboxOptions } from "./runtime";
import { createConsole, UISurface } from "./ui";
import type { AutoResize } from "./iframe";
import { JsxHost, VM_RUNTIME_SOURCE, type IntrinsicsPolicy } from "./jsx";
import { merge } from "./utils/merge";

/**
 * Context passed to the host `exposed` factory. Provides the three UI surfaces
 * plus the VM bridge so hosts can build their own API (e.g. `reearth.*`) and
 * have it merged alongside the built-in `console`/`ui`/`modal`/`popup`.
 */
export type PluginContext = SandboxBridge & {
  ui: UISurface;
  modal: UISurface;
  popup: UISurface;
};

export type PluginOptions = {
  /** Plugin source to evaluate. Provide either `code` or `src`. */
  code?: string;
  /** URL to fetch plugin source from. */
  src?: string;
  /** Element the main UI iframe mounts into. */
  container: HTMLElement;
  /** Element the modal iframe mounts into. Created in <body> if omitted. */
  modalContainer?: HTMLElement;
  /** Element the popup iframe mounts into. Created in <body> if omitted. */
  popupContainer?: HTMLElement;
  /** Auto-resize behavior for the main UI iframe. */
  autoResize?: AutoResize;
  /**
   * Opt in to the JSX UI runtime. When enabled, a `createElement`/`Fragment`,
   * hooks (`useState`, `useEffect`, ...) and a `render()` global are installed
   * in the VM, and `render(<App/>)` drives the main UI iframe declaratively.
   * Off by default; the plain `ui.show(html)` path is unaffected.
   */
  jsx?: boolean;
  /**
   * Trusted JS source, evaluated in the VM after the JSX runtime and before the
   * plugin, used to register custom components via `registerComponent(name, fn)`
   * (à la Figma's `View`/`Text`). Markup these components emit may use intrinsic
   * tags even when {@link intrinsics} forbids them in plugin code. Requires
   * {@link jsx}.
   */
  components?: string;
  /**
   * Gates plugin-authored intrinsic (HTML) tags: `true` (default, any), `false`
   * (none — plugins must use registered components), or an allowlist of tags.
   * Tags emitted inside registered components are always allowed. Requires
   * {@link jsx}.
   */
  intrinsics?: IntrinsicsPolicy;
  /** Builds the host-specific API merged into the exposed globals. */
  exposed?: (ctx: PluginContext) => Record<string, any>;
  /** QuickJS WASM module/variant override (see {@link SandboxOptions.quickjs}). */
  quickjs?: SandboxOptions["quickjs"];
  isMarshalable?: boolean | "json" | ((obj: any) => boolean | "json");
  onError?: (err: any) => void;
  onPreInit?: () => void;
  onDispose?: () => void;
  onMessage?: (msg: any) => void;
};

/**
 * High-level orchestrator: wires three sandboxed UI surfaces (ui/modal/popup)
 * to a QuickJS VM and exposes a default `{ console, ui, modal, popup }` global,
 * merged with any host-provided API.
 */
export class Plugin {
  readonly ui: UISurface;
  readonly modal: UISurface;
  readonly popup: UISurface;
  readonly sandbox: Sandbox;

  private ownedContainers: HTMLElement[] = [];
  private jsxHost?: JsxHost;

  constructor(options: PluginOptions) {
    const startEventLoop = () => this.sandbox?.requestEventLoop();

    const modalContainer = options.modalContainer ?? this.createContainer();
    const popupContainer = options.popupContainer ?? this.createContainer();

    this.ui = new UISurface({
      container: options.container,
      autoResize: options.autoResize,
      visible: true,
      startEventLoop,
      onProtocolMessage: (data) => this.jsxHost?.handle("ui", data) ?? false
    });
    this.modal = new UISurface({
      container: modalContainer,
      visible: true,
      startEventLoop,
      onProtocolMessage: (data) => this.jsxHost?.handle("modal", data) ?? false
    });
    this.popup = new UISurface({
      container: popupContainer,
      visible: true,
      startEventLoop,
      onProtocolMessage: (data) => this.jsxHost?.handle("popup", data) ?? false
    });

    if (options.jsx) {
      this.jsxHost = new JsxHost({
        surfaces: { ui: this.ui, modal: this.modal, popup: this.popup },
        intrinsics: options.intrinsics
      });
    }

    const bootstrap = options.jsx
      ? VM_RUNTIME_SOURCE + (options.components ? "\n;" + options.components : "")
      : undefined;

    this.sandbox = new Sandbox({
      code: options.code,
      src: options.src,
      quickjs: options.quickjs,
      isMarshalable: options.isMarshalable,
      bootstrap,
      onError: options.onError,
      onPreInit: options.onPreInit,
      onDispose: options.onDispose,
      onMessage: options.onMessage,
      exposed: (bridge) => {
        const base: Record<string, any> = {
          console: createConsole(),
          ui: this.ui.uiAPI,
          modal: this.modal.modalAPI,
          popup: this.popup.modalAPI
        };
        if (this.jsxHost) base.__zushi = this.jsxHost.bridge;
        const host =
          options.exposed?.({
            ui: this.ui,
            modal: this.modal,
            popup: this.popup,
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
    this.ui.dispose();
    this.modal.dispose();
    this.popup.dispose();
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
