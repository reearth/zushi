import { Sandbox, type SandboxBridge } from "./runtime";
import { createConsole, UISurface } from "./ui";
import type { AutoResize } from "./iframe";
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
  /** Builds the host-specific API merged into the exposed globals. */
  exposed?: (ctx: PluginContext) => Record<string, any>;
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

  constructor(options: PluginOptions) {
    const startEventLoop = () => this.sandbox?.requestEventLoop();

    const modalContainer = options.modalContainer ?? this.createContainer();
    const popupContainer = options.popupContainer ?? this.createContainer();

    this.ui = new UISurface({
      container: options.container,
      autoResize: options.autoResize,
      visible: true,
      startEventLoop
    });
    this.modal = new UISurface({
      container: modalContainer,
      visible: true,
      startEventLoop
    });
    this.popup = new UISurface({
      container: popupContainer,
      visible: true,
      startEventLoop
    });

    this.sandbox = new Sandbox({
      code: options.code,
      src: options.src,
      isMarshalable: options.isMarshalable,
      onError: options.onError,
      onPreInit: options.onPreInit,
      onDispose: options.onDispose,
      onMessage: options.onMessage,
      exposed: (bridge) => {
        const base = {
          console: createConsole(),
          ui: this.ui.uiAPI,
          modal: this.modal.modalAPI,
          popup: this.popup.modalAPI
        };
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
