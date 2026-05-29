/**
 * The React-based patcher that runs *inside* the sandboxed iframe (shipped as a
 * source string — it executes in the iframe, not Node, so it's excluded from
 * coverage).
 *
 * Renderer-agnostic: it turns serialized intrinsic trees into React elements via
 * a host-supplied component map and commits them with React (which does the
 * diffing). Pairs with libraries like react-konva (canvas), react-three-fiber,
 * react-pixi, etc. — the component map decides what `t` names mean.
 *
 * It reads three globals that the renderer's `bootstrap` must set up (so *how*
 * React and the components are loaded — bundled or via ESM CDN — is the host's
 * choice, not baked in here):
 *  - `__zushiReact`         — the React namespace (`createElement`, `Fragment`);
 *  - `__zushiCreateRoot`    — `createRoot` from `react-dom/client`;
 *  - `__zushiComponents`    — map of intrinsic tag name → React component.
 * Optionally `__zushiSerializeEvent(evt, type)` returns the payload posted to
 * the plugin handler (else a small generic default is used).
 *
 * Renders are buffered until those globals are ready, so an async (module)
 * bootstrap can resolve after the first tree arrives.
 */
function zushiReactPatcher() {
  const ROOT = "__zushi_root";
  const MSG_RENDER = "render";
  const MSG_EVENT = "event";
  const g: any = globalThis;
  const rootEl = document.getElementById(ROOT) as HTMLElement;

  let reactRoot: any = null;
  let currentGen = 0;
  let pending: any[] | null = null;

  function ready(): boolean {
    return !!(g.__zushiReact && g.__zushiCreateRoot && g.__zushiComponents);
  }

  function defaultSerialize(e: any): any {
    // Best-effort generic payload. Konva events expose the raw DOM event as
    // `e.evt`; plain React DOM events are the event itself.
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
  }

  function makeHandler(type: string, hid: number) {
    return function (e: any) {
      const ser = g.__zushiSerializeEvent
        ? g.__zushiSerializeEvent(e, type)
        : defaultSerialize(e);
      parent.postMessage(
        { __zushi: MSG_EVENT, hid: hid, type: type, g: currentGen, payload: ser },
        "*"
      );
    };
  }

  function toElement(node: any): any {
    const React = g.__zushiReact;
    if (node && typeof node.x === "string") return node.x; // text node
    const comp = g.__zushiComponents[node.t] || node.t;
    const props: any = {};
    const p = node.p || {};
    for (const k in p) props[k] = p[k];
    const ev = node.ev || [];
    for (let i = 0; i < ev.length; i++) {
      // "click" -> "onClick"; react-konva matches event names case-insensitively.
      const type: string = ev[i].t;
      const prop = "on" + type.charAt(0).toUpperCase() + type.slice(1);
      props[prop] = makeHandler(type, ev[i].h);
    }
    if (node.k != null) props.key = node.k;
    const kids = (node.c || []).map(toElement);
    return React.createElement(comp, props, ...kids);
  }

  function renderTree(tree: any[]): void {
    const React = g.__zushiReact;
    if (!reactRoot) reactRoot = g.__zushiCreateRoot(rootEl);
    const els = (tree || []).map(toElement);
    reactRoot.render(React.createElement(React.Fragment, null, els));
  }

  function flush(): void {
    if (pending == null) return;
    if (!ready()) {
      setTimeout(flush, 10);
      return;
    }
    const t = pending;
    pending = null;
    try {
      renderTree(t);
    } catch (err) {
      if (console && console.error) console.error("zushi react patcher", err);
    }
  }

  window.addEventListener("message", function (e: any) {
    const d: any = e.data;
    if (!d || d.__zushi !== MSG_RENDER) return;
    currentGen = d.g;
    pending = d.tree || [];
    flush();
  });
}

/** The React patcher as an IIFE source string, mounted into the iframe. */
export const REACT_PATCHER_SOURCE = "(" + zushiReactPatcher.toString() + ")();";
