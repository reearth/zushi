/**
 * Shared constants and wire types for the opt-in JSX UI layer.
 *
 * Three pieces of code cooperate across two isolation boundaries:
 *
 *  - the VM runtime ({@link ./vmRuntime}) runs inside the QuickJS VM and turns a
 *    component tree into a serializable tree of intrinsic nodes;
 *  - the host controller ({@link ./controller}) is a dumb pipe between the VM
 *    and the iframe;
 *  - the patcher ({@link ./patcher}) runs inside the sandboxed iframe and
 *    reconciles the serialized tree into real DOM.
 *
 * The VM runtime and the patcher are shipped as source strings (built via
 * `Function.prototype.toString`), so they cannot import from this module at
 * runtime — they inline the literal values below. Keep them in sync.
 */

/**
 * Sentinel value used for `Fragment`. It is a plain string (not a Symbol) so it
 * survives both VM marshalling and being bundled into plugin code through the
 * `jsx-runtime` shim — identity is by value, not reference.
 *
 * Must match the literal used in {@link ./vmRuntime}.
 */
export const FRAGMENT = "__zushi.Fragment";

/** Name of the host bridge object exposed into the VM when JSX is enabled. */
export const BRIDGE_GLOBAL = "__zushi";

/** Message tag: host/iframe → render a serialized tree. */
export const MSG_RENDER = "render";
/** Message tag: iframe → host, a DOM event fired on a tagged element. */
export const MSG_EVENT = "event";

/** A single registered event listener on a serialized element. */
export type SEvent = {
  /** DOM event type, e.g. "click", "input". */
  t: string;
  /** Handler id, valid only within the render generation it was produced in. */
  h: number;
};

/** A serialized node: either a text node or an intrinsic element. */
export type SNode =
  | { x: string }
  | {
      /** Intrinsic tag name. */
      t: string;
      /** Plain (function-free) props: attributes, `style` object, `className`. */
      p: Record<string, unknown>;
      /** Registered event listeners. */
      ev: SEvent[];
      /** Child nodes. */
      c: SNode[];
      /** Optional reconciliation key, used by the patcher's keyed diff. */
      k?: string | number;
    };

/** The UI surfaces a JSX root can target. */
export type SurfaceId = "ui" | "modal" | "popup";

/**
 * How plugin-authored intrinsic (HTML) tags are gated:
 *  - `true`  — any tag allowed (default);
 *  - `false` — none; plugins must render through registered components;
 *  - array   — only the listed tags are allowed.
 * Tags emitted *inside* a registered component are always allowed.
 */
export type IntrinsicsPolicy = boolean | string[];

/** Payload of a {@link MSG_RENDER} message. */
export type RenderPayload = {
  /** Render generation; bumped each render so stale events can be dropped. */
  g: number;
  /** Root children (the root may be a fragment, hence an array). */
  tree: SNode[];
};

/** Payload of a {@link MSG_EVENT} message. */
export type EventPayload = {
  /** Handler id. */
  hid: number;
  /** DOM event type. */
  type: string;
  /** Render generation the listener was attached in. */
  g: number;
  /** Curated, serializable subset of the DOM event. */
  payload: SerializedEvent;
};

/** The safe subset of a DOM event forwarded to plugin handlers. */
export type SerializedEvent = {
  value?: string;
  checked?: boolean;
  key?: string;
  code?: string;
  targetId?: string;
};

/** A virtual node produced by `createElement` / `jsx` inside the VM. */
export type VNode = {
  type: string | typeof FRAGMENT | ((props: any) => unknown);
  props: Record<string, any>;
  children: unknown[];
  key?: unknown;
};
