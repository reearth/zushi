import { ROOT_ID, type SNode } from "./protocol";
import { REACT_PATCHER_SOURCE } from "./reactPatcherSource";
import type { HostRenderer, Renderer } from "./renderer";

export type ReactRendererOptions = {
  /** Diagnostic label (default `"react"`). */
  name?: string;
  /**
   * A `<script type="module">` body, evaluated in the iframe, that loads React
   * and the component library and assigns the globals the patcher reads:
   *
   * ```js
   * globalThis.__zushiReact = React;                 // react
   * globalThis.__zushiCreateRoot = createRoot;       // react-dom/client
   * globalThis.__zushiComponents = { Stage, Layer }; // tag name -> component
   * // optional:
   * globalThis.__zushiSerializeEvent = (evt, type) => ({ ... });
   * ```
   *
   * Supply React/components however you like — bundle them, or import from an
   * ESM CDN. zushi stays free of any React/canvas dependency.
   */
  bootstrap: string;
  /** Extra markup injected into `<head>` (e.g. `<style>`). */
  head?: string;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const defaultSerialize = (e: any): any => {
  const evt = e && e.evt ? e.evt : e;
  const out: any = {};
  if (evt) {
    if (typeof evt.offsetX === "number") out.x = evt.offsetX;
    if (typeof evt.offsetY === "number") out.y = evt.offsetY;
    if (evt.key != null) out.key = evt.key;
    const tgt = evt.target || {};
    if (tgt.value != null) out.value = tgt.value;
    if (tgt.checked != null) out.checked = tgt.checked;
  }
  return out;
};

export type HostReactRendererOptions = {
  /** Diagnostic label (default `"react-host"`). */
  name?: string;
  /** The React namespace (`createElement`, `Fragment`). */
  React: any;
  /** `createRoot` from `react-dom/client`. */
  createRoot: (container: HTMLElement) => {
    render(node: unknown): void;
    unmount(): void;
  };
  /** Map of intrinsic tag name → React component (e.g. react-konva's Stage). */
  components: Record<string, any>;
  /** Per-event payload serializer; default extracts pointer/key/value. */
  serializeEvent?: (evt: unknown, type: string) => unknown;
  /**
   * Allow tags absent from {@link components} to render as **raw host DOM
   * elements**. Off by default: this renderer draws directly in the host page
   * with no iframe isolation, so letting untrusted plugin trees instantiate
   * arbitrary DOM (and its attributes) reopens the very injection surface the
   * iframe renderers close. Leave this off unless you fully trust the plugin
   * source; unknown tags are otherwise dropped (their children still render).
   */
  allowIntrinsicDOM?: boolean;
};

// Props that carry a URL; a `javascript:`/`vbscript:` value here executes.
const URL_PROPS = new Set([
  "href",
  "src",
  "xlinkHref",
  "formAction",
  "action",
  "srcDoc",
  "poster",
  "background"
]);

const isUnsafeUrl = (v: unknown): boolean => {
  if (typeof v !== "string") return false;
  // Browsers ignore leading control chars/whitespace when resolving a scheme,
  // so strip them before matching to defeat `java\tscript:` style obfuscation.
  let s = "";
  for (let i = 0; i < v.length; i++) {
    if (v.charCodeAt(i) > 0x20) s += v[i];
  }
  s = s.toLowerCase();
  return (
    s.startsWith("javascript:") ||
    s.startsWith("vbscript:") ||
    s.startsWith("data:text/html")
  );
};

/**
 * Copy plugin-controlled props while refusing the ones that turn serialized
 * data into host-page code execution — the contract a host-direct renderer
 * must uphold (see {@link HostRenderer}). Strips `dangerouslySetInnerHTML` and
 * `ref`, drops `javascript:` URLs, and rejects string-valued event handlers.
 */
const sanitizeProps = (p: Record<string, any>): Record<string, any> => {
  const props: any = {};
  for (const k in p) {
    if (k === "dangerouslySetInnerHTML" || k === "ref") continue;
    const v = p[k];
    if (URL_PROPS.has(k) && isUnsafeUrl(v)) continue;
    if (typeof v === "string" && k.length > 2 && k[0] === "o" && k[1] === "n")
      continue;
    props[k] = v;
  }
  return props;
};

/**
 * Build a host-direct {@link HostRenderer} that commits serialized trees with
 * React, in the host page (no iframe), via a component map you pass directly —
 * no `bootstrap`, no CDN, no cross-origin loading. Ideal for react-konva &
 * friends: the host app supplies its own React and components, so there is one
 * deduped instance and the usual canvas-library setup just works.
 *
 * Only safe for non-DOM, non-executing targets — see {@link HostRenderer}.
 * Tags absent from `components` are dropped (not rendered as raw host DOM)
 * and plugin props that carry executable content are stripped, unless
 * {@link HostReactRendererOptions.allowIntrinsicDOM} opts back in.
 */
export function hostReactRenderer(options: HostReactRendererOptions): HostRenderer {
  const { React, components } = options;
  const serialize = options.serializeEvent ?? defaultSerialize;
  const allowIntrinsicDOM = options.allowIntrinsicDOM ?? false;
  const warned = new Set<string>();

  return {
    name: options.name ?? "react-host",
    target: "host",
    mount(container, ctx) {
      const root = options.createRoot(container);
      let gen = 0;

      const toElement = (node: SNode): any => {
        if (node && typeof (node as any).x === "string") return (node as any).x;
        const el = node as Extract<SNode, { t: string }>;
        const props = sanitizeProps(el.p || {});
        const ev = el.ev || [];
        for (let i = 0; i < ev.length; i++) {
          const type = ev[i].t;
          const hid = ev[i].h;
          props["on" + cap(type)] = (e: any) =>
            ctx.onEvent(hid, type, serialize(e, type), gen);
        }
        if (el.k != null) props.key = el.k;
        const kids = (el.c || []).map(toElement);

        const comp = components[el.t];
        if (!comp && !allowIntrinsicDOM) {
          // A tag with no registered component would otherwise fall back to a
          // raw host DOM element — the injection surface this renderer must
          // not open. Drop the element but keep its children so a stray
          // wrapper doesn't erase a whole subtree.
          if (!warned.has(el.t)) {
            warned.add(el.t);
            console.warn(
              `zushi: hostReactRenderer dropped unregistered tag "${el.t}"; ` +
                "add it to `components` or set `allowIntrinsicDOM` to render it."
            );
          }
          return React.createElement(
            React.Fragment,
            el.k != null ? { key: el.k } : null,
            ...kids
          );
        }
        return React.createElement(comp || el.t, props, ...kids);
      };

      return {
        render(tree, g) {
          gen = g;
          const els = (tree || []).map(toElement);
          root.render(React.createElement(React.Fragment, null, ...els));
        },
        dispose() {
          root.unmount();
        }
      };
    }
  };
}

/**
 * Build a {@link Renderer} that commits serialized trees with React via a
 * host-supplied component map — the basis for canvas renderers like react-konva.
 */
export function reactRenderer(options: ReactRendererOptions): Renderer {
  const patcherHtml =
    '<!doctype html><html><head><meta charset="utf-8">' +
    "<style>*{box-sizing:border-box}html,body{margin:0;padding:0}</style>" +
    (options.head ?? "") +
    "</head><body>" +
    '<div id="' +
    ROOT_ID +
    '"></div>' +
    '<script type="module">' +
    options.bootstrap +
    "</script>" +
    "<script>" +
    REACT_PATCHER_SOURCE +
    "</script>" +
    "</body></html>";
  return { name: options.name ?? "react", patcherHtml };
}
