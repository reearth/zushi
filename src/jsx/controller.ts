import type { UISurface } from "../ui/uiSurface";
import { PATCHER_HTML } from "./patcher";
import {
  MSG_EVENT,
  MSG_RENDER,
  type IntrinsicsPolicy,
  type RenderPayload,
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
  private mounted = false;

  constructor(surface: UISurface, onEvent: (data: any) => void) {
    this.surface = surface;
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
      this.surface.show(PATCHER_HTML, options ?? {});
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
}

export type JsxHostOptions = {
  surfaces: Partial<Record<SurfaceId, UISurface>>;
  intrinsics?: IntrinsicsPolicy;
};

/**
 * Coordinates the JSX layer across surfaces. Builds the `__zushi` object
 * exposed into the VM (render routing + config), holds the VM's dispatch
 * function, and routes incoming iframe events to it tagged with their surface.
 */
export class JsxHost {
  private controllers = new Map<SurfaceId, JsxController>();
  private dispatch: DispatchFn | undefined;
  private intrinsics: IntrinsicsPolicy;

  constructor(options: JsxHostOptions) {
    this.intrinsics = options.intrinsics ?? true;
    for (const id of Object.keys(options.surfaces) as SurfaceId[]) {
      const surface = options.surfaces[id];
      if (!surface) continue;
      this.controllers.set(
        id,
        new JsxController(surface, (data) =>
          this.dispatch?.(id, data.hid, data.type, data.payload, data.g)
        )
      );
    }
  }

  /** Protocol interceptor for a surface; pass to `UISurface.onProtocolMessage`. */
  handle(id: SurfaceId, data: any): boolean {
    return this.controllers.get(id)?.handleMessage(data) ?? false;
  }

  /** The object exposed into the VM as `__zushi`. */
  get bridge(): {
    render: (surfaceId: SurfaceId, payload: RenderPayload, options?: any) => void;
    ready: (dispatch: DispatchFn) => void;
    config: { intrinsics: IntrinsicsPolicy };
  } {
    return {
      render: (surfaceId, payload, options) =>
        this.controllers.get(surfaceId)?.push(payload, options),
      ready: (dispatch) => {
        this.dispatch = dispatch;
      },
      config: { intrinsics: this.intrinsics }
    };
  }
}
