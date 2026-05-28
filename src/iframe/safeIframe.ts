import { autoResizeScript, insertToBody, sizeToPx } from "./utils";
import type { AutoResize, IFrameAPI, RenderOptions } from "./types";

export const DEFAULT_AUTO_RESIZE_MESSAGE_KEY = "___iframe_auto_resize___";
export const DEFAULT_SANDBOX = "allow-scripts allow-downloads allow-popups";

export type SafeIFrameOptions = {
  /** Element the iframe is appended to. */
  container: HTMLElement;
  autoResize?: AutoResize;
  autoResizeMessageKey?: string;
  /**
   * The iframe `sandbox` attribute. Intentionally excludes `allow-same-origin`
   * so the iframe stays in an opaque origin with no access to the host.
   */
  sandbox?: string;
  className?: string;
  /** Master visibility gate (equivalent to "enabled & visible"). */
  visible?: boolean;
  onMessage?: (message: any) => void;
  onLoad?: () => void;
  onClick?: () => void;
};

/**
 * A single sandboxed iframe whose content is supplied as an HTML string via
 * `srcDoc`. Provides a framework-agnostic bridge: postMessage with a pending
 * queue, message reception with source verification, auto-resize, and
 * visibility / size control.
 */
export class SafeIFrame {
  readonly api: IFrameAPI;

  private container: HTMLElement;
  private iframe: HTMLIFrameElement | undefined;
  private loaded = false;
  private pendingMessages: any[] = [];

  private autoResize?: AutoResize;
  private autoResizeMessageKey: string;
  private sandbox: string;
  private className?: string;

  private canBeVisible: boolean;
  private renderVisible = true;
  private html = "";
  private size: [string | undefined, string | undefined] | undefined;

  private onMessageCb?: (message: any) => void;
  private onLoadCb?: () => void;
  private onClickCb?: () => void;
  private onAutoResizedCb?: () => void;

  private messageListener: (ev: MessageEvent) => void;
  private blurListener: () => void;

  constructor(options: SafeIFrameOptions) {
    this.container = options.container;
    this.autoResize = options.autoResize;
    this.autoResizeMessageKey =
      options.autoResizeMessageKey ?? DEFAULT_AUTO_RESIZE_MESSAGE_KEY;
    this.sandbox = options.sandbox ?? DEFAULT_SANDBOX;
    this.className = options.className;
    this.canBeVisible = options.visible ?? true;
    this.onMessageCb = options.onMessage;
    this.onLoadCb = options.onLoad;
    this.onClickCb = options.onClick;

    this.messageListener = (ev: MessageEvent) => {
      if (!this.iframe || ev.source !== this.iframe.contentWindow) return;
      const resize = ev.data?.[this.autoResizeMessageKey];
      if (resize) {
        const { width, height } = resize;
        if (typeof width !== "number" || typeof height !== "number") return;
        this.size = [`${width}px`, `${height}px`];
        this.applyStyle();
        this.onAutoResizedCb?.();
      } else {
        this.onMessageCb?.(ev.data);
      }
    };

    this.blurListener = () => {
      if (this.iframe && this.iframe === document.activeElement) {
        this.onClickCb?.();
      }
    };

    window.addEventListener("message", this.messageListener);
    window.addEventListener("blur", this.blurListener);

    this.api = {
      render: (html, options) => this.render(html, options),
      resize: (width, height) => this.resize(width, height),
      postMessage: (message) => this.postMessage(message)
    };
  }

  render(html: string, options: RenderOptions = {}): void {
    const { visible = true, width, height, onAutoResized } = options;
    this.renderVisible = visible;
    this.onAutoResizedCb = onAutoResized;
    if (width !== undefined || height !== undefined) {
      this.size = sizeToPx(width, height);
    }

    if (html !== this.html || !this.iframe) {
      this.html = html;
      this.mount(html);
    } else {
      this.applyStyle();
    }
  }

  resize(
    width: string | number | undefined,
    height: string | number | undefined
  ): void {
    this.size = sizeToPx(width, height);
    this.applyStyle();
  }

  postMessage(message: any): void {
    let cloned: any;
    try {
      cloned = JSON.parse(JSON.stringify(message));
    } catch (err) {
      console.error("niche: failed to serialize message", err);
      return;
    }
    if (this.iframe && this.loaded && this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage(cloned, "*");
    } else {
      this.pendingMessages.push(cloned);
    }
  }

  setVisible(visible: boolean): void {
    this.canBeVisible = visible;
    this.applyStyle();
  }

  /** Clears the rendered content and removes the iframe element. */
  reset(): void {
    this.html = "";
    this.loaded = false;
    this.pendingMessages = [];
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = undefined;
    }
  }

  /** Tears down listeners and removes the iframe. Not reusable afterwards. */
  dispose(): void {
    window.removeEventListener("message", this.messageListener);
    window.removeEventListener("blur", this.blurListener);
    this.reset();
  }

  private mount(html: string): void {
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = undefined;
    }
    this.loaded = false;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("frameborder", "no");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("data-testid", "iframe");
    iframe.setAttribute("sandbox", this.sandbox);
    iframe.setAttribute("allow", "");
    if (this.className) iframe.className = this.className;
    iframe.srcdoc = insertToBody(
      html,
      autoResizeScript(this.autoResizeMessageKey)
    );
    iframe.addEventListener("load", () => this.handleLoad());

    this.iframe = iframe;
    this.applyStyle();
    this.container.appendChild(iframe);
  }

  private handleLoad(): void {
    this.loaded = true;
    if (this.pendingMessages.length && this.iframe?.contentWindow) {
      for (const message of this.pendingMessages) {
        this.iframe.contentWindow.postMessage(message, "*");
      }
      this.pendingMessages = [];
    }
    this.onLoadCb?.();
  }

  private effectiveVisible(): boolean {
    return this.canBeVisible && this.renderVisible;
  }

  private applyStyle(): void {
    if (!this.iframe) return;
    const visible = this.effectiveVisible();
    const style = this.iframe.style;
    style.display = visible ? "block" : "none";
    style.width = visible
      ? !this.autoResize || this.autoResize === "height-only"
        ? "100%"
        : (this.size?.[0] ?? "")
      : "0px";
    style.height = visible
      ? !this.autoResize || this.autoResize === "width-only"
        ? "100%"
        : (this.size?.[1] ?? "")
      : "0px";
  }
}
