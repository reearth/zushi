import type { UISurface } from "../ui/uiSurface";
import {
  domRenderer,
  isHostRenderer,
  type AnyRenderer,
  type HostRenderer,
  type HostRendererInstance
} from "./renderer";
import type { SyncedStore } from "./syncedStore";
import {
  MSG_EVENT,
  MSG_RENDER,
  type IntrinsicsPolicy,
  type RenderPayload,
  type RuntimeNamespace,
  type RuntimePlacement,
  type SurfaceId
} from "./protocol";

type DispatchFn = (
  surfaceId: SurfaceId,
  hid: number,
  type: string,
  payload: unknown,
  g: number
) => void;

/**
 * Host-side glue for a single surface's iframe. It is intentionally dumb: it
 * does not understand the element tree. It mounts the patcher into the iframe
 * once, forwards serialized trees from the VM to the iframe, and forwards DOM
 * events from the iframe back out via `onEvent`.
 */
class JsxController {
  private surface: UISurface;
  private onEvent: (data: any) => void;
  private patcherHtml: string;
  private mounted = false;

  constructor(
    surface: UISurface,
    patcherHtml: string,
    onEvent: (data: any) => void
  ) {
    this.surface = surface;
    this.patcherHtml = patcherHtml;
    this.onEvent = onEvent;
  }

  /** Returns `true` when it consumes a zushi-protocol message. */
  handleMessage = (data: any): boolean => {
    if (data && data.__zushi === MSG_EVENT) {
      this.onEvent(data);
      return true;
    }
    return false;
  };

  push(payload: RenderPayload, options?: any): void {
    if (!this.mounted) {
      this.surface.show(this.patcherHtml, options ?? {});
      this.mounted = true;
    } else if (options && (options.width != null || options.height != null)) {
      this.surface.resize(options.width, options.height);
    }
    this.surface.postMessage({
      __zushi: MSG_RENDER,
      g: payload.g,
      tree: payload.tree
    });
  }

  dispose(): void {}
}

/**
 * Host-side glue for a {@link HostRenderer}: mounts the renderer directly into
 * the surface's container (no iframe) and hands it serialized trees in-realm.
 * Same `push`/event shape as {@link JsxController} so {@link JsxHost} treats
 * both uniformly.
 */
class HostController {
  private container: HTMLElement;
  private renderer: HostRenderer;
  private onEvent: (data: any) => void;
  private instance: HostRendererInstance | undefined;

  constructor(
    container: HTMLElement,
    renderer: HostRenderer,
    onEvent: (data: any) => void
  ) {
    this.container = container;
    this.renderer = renderer;
    this.onEvent = onEvent;
  }

  push(payload: RenderPayload, options?: any): void {
    if (!this.instance) {
      this.instance = this.renderer.mount(this.container, {
        onEvent: (hid, type, p, g) =>
          this.onEvent({ hid, type, payload: p, g })
      });
    } else if (
      this.instance.resize &&
      options &&
      (options.width != null || options.height != null)
    ) {
      this.instance.resize(options.width, options.height);
    }
    this.instance.render(payload.tree, payload.g);
  }

  dispose(): void {
    this.instance?.dispose();
    this.instance = undefined;
  }
}

export type JsxHostOptions = {
  surfaces: Partial<Record<SurfaceId, UISurface>>;
  intrinsics?: IntrinsicsPolicy;
  /**
   * The renderer each surface uses. An iframe {@link Renderer} (default DOM) or
   * a host-direct {@link HostRenderer}.
   */
  renderer?: AnyRenderer;
  /**
   * Pumps the VM job loop. Iframe renderers pump via the surface's message
   * channel; host-direct renderers deliver events in-realm, so the host must
   * pump after dispatching one (so the resulting re-render runs). Also pumped
   * after any {@link synced} store change so synced-state re-renders run.
   */
  startEventLoop?: () => void;
  /** Backing store for `useSyncedState` / `useSyncedMap` (exposed via the bridge). */
  synced?: SyncedStore;
  /** Default placement for the runtime API (see {@link RuntimeNamespace}). */
  namespace?: RuntimeNamespace;
  /** Whether `registerComponent` is included in the default placement. */
  exposeRegisterComponent?: boolean;
};

/**
 * Coordinates the JSX layer across surfaces. Builds the `__zushi` object
 * exposed into the VM (render routing + config), holds the VM's dispatch
 * function, and routes incoming iframe events to it tagged with their surface.
 */
export class JsxHost {
  private controllers = new Map<SurfaceId, JsxController | HostController>();
  private dispatch: DispatchFn | undefined;
  private intrinsics: IntrinsicsPolicy;
  private namespace: RuntimeNamespace;
  private exposeRegisterComponent: boolean;
  private startEventLoop?: () => void;
  private synced?: SyncedStore;
  private unsubSynced?: () => void;
  private placements: RuntimePlacement[] = [];

  private names: SurfaceId[];

  constructor(options: JsxHostOptions) {
    this.intrinsics = options.intrinsics ?? true;
    this.namespace = options.namespace ?? "zushi";
    this.exposeRegisterComponent = options.exposeRegisterComponent ?? false;
    this.startEventLoop = options.startEventLoop;
    this.synced = options.synced;
    // Pump the VM job loop after any synced change (host- or plugin-initiated)
    // so the resulting re-render runs.
    if (this.synced && this.startEventLoop) {
      this.unsubSynced = this.synced.subscribe(() => this.startEventLoop!());
    }
    const renderer = options.renderer ?? domRenderer;
    const host = isHostRenderer(renderer);
    this.names = Object.keys(options.surfaces);
    for (const id of this.names) {
      const surface = options.surfaces[id];
      if (!surface) continue;
      const onEvent = (data: any) => {
        this.dispatch?.(id, data.hid, data.type, data.payload, data.g);
        // Iframe events get pumped by the surface's message handler; host-direct
        // events arrive in-realm, so pump here to run the resulting re-render.
        if (host) this.startEventLoop?.();
      };
      this.controllers.set(
        id,
        isHostRenderer(renderer)
          ? new HostController(surface.container, renderer, onEvent)
          : new JsxController(surface, renderer.patcherHtml, onEvent)
      );
    }
  }

  /** Protocol interceptor for a surface; pass to `UISurface.onProtocolMessage`. */
  handle(id: SurfaceId, data: any): boolean {
    const c = this.controllers.get(id);
    return c instanceof JsxController ? c.handleMessage(data) : false;
  }

  /** Tear down all controllers (host renderers unmount their roots). */
  dispose(): void {
    for (const c of this.controllers.values()) c.dispose();
    this.unsubSynced?.();
  }

  /**
   * Record where the host placed runtime refs (extracted from its `exposed`
   * tree). Must be called before the VM evaluates the bootstrap, since the
   * runtime reads these via {@link bridge}'s config.
   */
  setPlacements(placements: RuntimePlacement[]): void {
    this.placements = placements;
  }

  /** The object exposed into the VM as `__zushi`. */
  get bridge(): {
    render: (surfaceId: SurfaceId, payload: RenderPayload, options?: any) => void;
    ready: (dispatch: DispatchFn) => void;
    synced?: VmSyncedApi;
    config: {
      intrinsics: IntrinsicsPolicy;
      surfaces: SurfaceId[];
      defaultSurface: SurfaceId | undefined;
      placements: RuntimePlacement[];
      namespace: RuntimeNamespace;
      exposeRegisterComponent: boolean;
    };
  } {
    const synced = this.synced;
    return {
      render: (surfaceId, payload, options) =>
        this.controllers.get(surfaceId)?.push(payload, options),
      ready: (dispatch) => {
        this.dispatch = dispatch;
      },
      // VM-facing synced-store facade (used by useSyncedState / useSyncedMap).
      synced: synced
        ? {
            has: (k) => synced.has(k),
            get: (k) => synced.get(k),
            set: (k, v) => synced.set(k, v),
            delete: (k) => synced.delete(k),
            keys: () => synced.keys(),
            subscribe: (k, cb) => synced.subscribeKey(k, cb)
          }
        : undefined,
      config: {
        intrinsics: this.intrinsics,
        surfaces: this.names,
        // Prefer a surface named "ui"; otherwise fall back to the only one.
        defaultSurface: this.names.includes("ui")
          ? "ui"
          : this.names.length === 1
            ? this.names[0]
            : undefined,
        placements: this.placements,
        namespace: this.namespace,
        exposeRegisterComponent: this.exposeRegisterComponent
      }
    };
  }
}

/** The synced-store facade marshaled into the VM as `__zushi.synced`. */
type VmSyncedApi = {
  has: (key: string) => boolean;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
  keys: () => string[];
  subscribe: (key: string, cb: () => void) => () => void;
};
