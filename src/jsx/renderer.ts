import { PATCHER_HTML } from "./patcher";
import type { SNode } from "./protocol";

/**
 * A pluggable renderer for the JSX layer. The in-VM runtime and the host
 * controller are renderer-agnostic — they serialize the component tree to an
 * intrinsic-only tree (see {@link ./protocol}) and pipe it into a sandboxed
 * iframe. A `Renderer` supplies the *patcher*: the iframe document that turns
 * those serialized trees into something visible and posts DOM/canvas events
 * back. The built-in {@link domRenderer} patches HTML DOM; other renderers
 * (e.g. a react-konva canvas patcher) implement the same patcher contract.
 *
 * ## Patcher contract
 *
 * The patcher document must:
 *  - host an element with id {@link ROOT_ID} to render into;
 *  - on `window` `message` events `{ __zushi: "render", g, tree }` (see
 *    {@link RenderPayload}), reconcile `tree` into that root (full tree each
 *    time — diff however the renderer likes);
 *  - for each serialized event listener, post
 *    `{ __zushi: "event", hid, type, g, payload }` to `parent` when it fires.
 *    `payload` is renderer-defined (it is handed verbatim to the plugin's
 *    handler), so a canvas renderer may include pointer coordinates, etc.
 *
 * Which intrinsic tag names are valid is orthogonal — set the host's
 * `intrinsics` policy to the renderer's vocabulary (e.g. `["Stage","Layer",
 * "Rect"]` for konva).
 */
export interface Renderer {
  /** Human-readable label for diagnostics (e.g. `"dom"`, `"konva"`). */
  readonly name: string;
  /** Renders inside a sandboxed iframe (the default isolation). */
  readonly target?: "iframe";
  /** The full iframe document, mounted once per surface. */
  readonly patcherHtml: string;
}

/**
 * A renderer that draws **directly in the host page** (no iframe), into the
 * surface's container. Use this only for targets that cannot be coerced into
 * code/markup execution — `<canvas>` / WebGL (e.g. react-konva, react-three-
 * fiber) — since it gives up the iframe isolation layer.
 *
 * ## Why this is safe for canvas (and not for DOM)
 *
 * Plugin code stays in the VM; only a serialized data tree ({@link SNode})
 * crosses to the host — never code or functions. So a host-direct renderer is
 * safe **as long as it never turns that data into execution**: no `eval` /
 * `new Function`, no `innerHTML` / `dangerouslySetInnerHTML`, no DOM-building
 * components (react-konva's `Html`, …), and no routing data into `href` / `src`
 * / `fetch`. Canvas drawing primitives (shapes, text, transforms) meet this
 * bar; arbitrary HTML does not — render HTML through an iframe {@link Renderer}.
 */
export interface HostRenderer {
  /** Human-readable label for diagnostics (e.g. `"konva"`). */
  readonly name: string;
  /** Marks this as a host-direct renderer (no iframe). */
  readonly target: "host";
  /** Mount into a surface's container; returns the live instance. */
  mount(container: HTMLElement, ctx: HostRenderContext): HostRendererInstance;
}

/** Wiring handed to a {@link HostRenderer} at mount time. */
export type HostRenderContext = {
  /** Forward a UI event to the plugin's handler (by id, within generation). */
  onEvent: (hid: number, type: string, payload: unknown, gen: number) => void;
};

/** A mounted {@link HostRenderer}. */
export interface HostRendererInstance {
  /** Draw a serialized tree (the full tree each call; diff as you like). */
  render(tree: SNode[], gen: number): void;
  /** Optional resize hook (width/height from `render(el, { width, height })`). */
  resize?(width?: number | string, height?: number | string): void;
  dispose(): void;
}

/** A renderer is either iframe-isolated or host-direct. */
export type AnyRenderer = Renderer | HostRenderer;

/** Narrows {@link AnyRenderer} to a host-direct renderer. */
export function isHostRenderer(r: AnyRenderer): r is HostRenderer {
  return (r as HostRenderer).target === "host";
}

/**
 * The built-in renderer: reconciles serialized trees into real HTML DOM in the
 * sandboxed iframe (intrinsic tags are HTML elements, `style` is CSS, `value`/
 * `checked` are controlled, IME composition is preserved). The default.
 */
export const domRenderer: Renderer = {
  name: "dom",
  patcherHtml: PATCHER_HTML
};
