import { events, type EventEmitter, type Events } from "../events";
import { SafeIFrame, type AutoResize } from "../iframe";

export type UIEvents = {
  message: [message: any];
  close: [];
};

export type UIShowOptions = {
  visible?: boolean;
  width?: number | string;
  height?: number | string;
};

export type UISurfaceOptions = {
  /** Element the surface's iframe mounts into. */
  container: HTMLElement;
  autoResize?: AutoResize;
  visible?: boolean;
  /** Called after a message arrives so the VM job loop can be pumped. */
  startEventLoop?: () => void;
  /**
   * Given first crack at every incoming iframe message. Returning `true`
   * marks the message as consumed so it is not emitted as a `message` event.
   * Used by the JSX layer to keep its protocol off the plugin message channel.
   */
  onProtocolMessage?: (data: any) => boolean;
};

/** The method surface a host typically exposes to plugins for a UI surface. */
export type SurfaceAPI = Pick<
  UISurface,
  "show" | "postMessage" | "resize" | "update" | "close" | "on" | "off"
>;

/**
 * A plugin UI surface (main UI, modal, or popup) backed by a sandboxed iframe.
 * Plugins render HTML into it and exchange messages with it.
 */
export class UISurface {
  readonly frame: SafeIFrame;
  readonly events: Events<UIEvents>;
  /**
   * The element this surface mounts into. The sandboxed iframe is created
   * lazily on {@link show}; a host-direct renderer mounts here instead.
   */
  readonly container: HTMLElement;

  private emit: EventEmitter<UIEvents>;
  private startEventLoop?: () => void;
  private onProtocolMessage?: (data: any) => boolean;
  private html = "";
  private options: UIShowOptions = {};

  constructor(opts: UISurfaceOptions) {
    [this.events, this.emit] = events<UIEvents>();
    this.container = opts.container;
    this.startEventLoop = opts.startEventLoop;
    this.onProtocolMessage = opts.onProtocolMessage;
    this.frame = new SafeIFrame({
      container: opts.container,
      autoResize: opts.autoResize,
      visible: opts.visible,
      onMessage: (data) => {
        if (!this.onProtocolMessage?.(data)) {
          this.emit("message", data);
        }
        this.startEventLoop?.();
      }
    });
  }

  show = (html: string, options: UIShowOptions = {}): void => {
    this.html = html;
    this.options = options;
    this.frame.render(html, options);
  };

  update = (options: UIShowOptions): void => {
    this.options = { ...this.options, ...options };
    this.frame.render(this.html, this.options);
  };

  resize = (width?: number | string, height?: number | string): void => {
    this.frame.resize(width, height);
  };

  postMessage = (message: any): void => {
    this.frame.postMessage(message);
  };

  close = (): void => {
    this.frame.setVisible(false);
    this.emit("close");
    this.startEventLoop?.();
  };

  on = <T extends keyof UIEvents>(
    type: T,
    cb: (...args: UIEvents[T]) => void
  ): void => {
    this.events.on(type, cb);
  };

  off = <T extends keyof UIEvents>(
    type: T,
    cb: (...args: UIEvents[T]) => void
  ): void => {
    this.events.off(type, cb);
  };

  dispose(): void {
    this.frame.dispose();
  }

  /** The method surface a host typically exposes to plugins. */
  get api(): SurfaceAPI {
    const { show, postMessage, resize, update, close, on, off } = this;
    return { show, postMessage, resize, update, close, on, off };
  }
}
