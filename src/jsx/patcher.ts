/**
 * The DOM patcher that runs *inside* the sandboxed iframe.
 *
 * Authored as a self-contained function and shipped as the iframe's HTML (see
 * {@link PATCHER_HTML}). It receives serialized intrinsic-only trees from the
 * host, reconciles them against the live DOM (an index-based diff that reuses
 * nodes so focus / caret survive), wires delegated-ish event listeners that
 * post a curated event back to the host, and keeps controlled inputs in sync
 * (with a guard so IME composition isn't clobbered).
 *
 * It must not reference the outer module scope; it talks to the host purely
 * via `postMessage`. Wire shapes mirror ./protocol.ts.
 */
function zushiPatcher() {
  const ROOT_ID = "__zushi_root";
  const MSG_RENDER = "render";
  const MSG_EVENT = "event";

  const root = document.getElementById(ROOT_ID) as HTMLElement;
  let prevTree: any[] = [];
  let currentGen = 0;

  window.addEventListener("message", function (e) {
    const d: any = e.data;
    if (!d || d.__zushi !== MSG_RENDER) return;
    currentGen = d.g;
    try {
      patchChildren(root, prevTree, d.tree || []);
      prevTree = d.tree || [];
    } catch (err) {
      if (console && console.error) console.error("zushi patcher", err);
    }
  });

  function isText(n: any): boolean {
    return n && typeof n.x === "string";
  }

  // ---- diff -------------------------------------------------------------

  function nodeKey(n: any): any {
    return n && !isText(n) && n.k != null ? n.k : undefined;
  }

  // Reconciles `parent`'s DOM children to `newCh`. Keyed nodes are matched by
  // key (so reordering reuses/moves DOM); unkeyed nodes fall back to positional
  // matching, which preserves focus/caret on inputs across re-renders.
  function patchChildren(parent: Node, oldCh: any[], newCh: any[]) {
    const oldDoms: any[] = [];
    for (let i = 0; i < parent.childNodes.length; i++)
      oldDoms.push(parent.childNodes[i]);

    const keyed: Record<string, any> = {};
    for (let i = 0; i < oldCh.length; i++) {
      const k = nodeKey(oldCh[i]);
      if (k != null) keyed[k] = { node: oldCh[i], dom: oldDoms[i], used: false };
    }

    const result: any[] = [];
    let oldIdx = 0;
    for (let i = 0; i < newCh.length; i++) {
      const n = newCh[i];
      const k = nodeKey(n);
      let dom: any = null;
      let oldN: any = null;

      if (k != null) {
        const m = keyed[k];
        if (m && !m.used && sameType(m.node, n)) {
          dom = m.dom;
          oldN = m.node;
          m.used = true;
        }
      } else {
        // Advance past keyed/consumed olds to the next positional unkeyed one.
        while (oldIdx < oldCh.length && nodeKey(oldCh[oldIdx]) != null) oldIdx++;
        if (oldIdx < oldCh.length) {
          const cand = oldCh[oldIdx];
          const cdom = oldDoms[oldIdx];
          if (sameType(cand, n)) {
            dom = cdom;
            oldN = cand;
          }
          oldIdx++;
        }
      }

      if (dom) patchNode(dom, oldN, n);
      else dom = createDom(n);
      result.push(dom);
    }

    // Drop any old DOM nodes not reused.
    const keep = new Set(result);
    for (let i = 0; i < oldDoms.length; i++) {
      const d = oldDoms[i];
      if (!keep.has(d) && d.parentNode === parent) parent.removeChild(d);
    }

    // Place children in their new order (insertBefore is a move if attached).
    for (let i = 0; i < result.length; i++) {
      const d = result[i];
      if (parent.childNodes[i] !== d)
        parent.insertBefore(d, parent.childNodes[i] || null);
    }
  }

  function sameType(a: any, b: any): boolean {
    if (isText(a) || isText(b)) return isText(a) && isText(b);
    return a.t === b.t;
  }

  function patchNode(dom: any, oldN: any, newN: any) {
    if (isText(newN)) {
      if (oldN.x !== newN.x) dom.textContent = newN.x;
      return;
    }
    patchProps(dom, oldN.p || {}, newN.p || {});
    patchEvents(dom, newN.ev || []);
    patchChildren(dom, oldN.c || [], newN.c || []);
  }

  // ---- create -----------------------------------------------------------

  function createDom(node: any): Node {
    if (isText(node)) return document.createTextNode(node.x);
    const el = document.createElement(node.t);
    if (node.t === "input" || node.t === "textarea") attachComposition(el);
    patchProps(el, {}, node.p || {});
    patchEvents(el, node.ev || []);
    const children = node.c || [];
    for (let i = 0; i < children.length; i++) el.appendChild(createDom(children[i]));
    return el;
  }

  // ---- props ------------------------------------------------------------

  const CONTROLLED = { value: true, checked: true };

  function patchProps(el: any, oldP: any, newP: any) {
    for (const k in oldP) {
      if (!(k in newP)) removeProp(el, k);
    }
    for (const k2 in newP) {
      if (oldP[k2] !== newP[k2] || k2 === "style") setProp(el, k2, newP[k2]);
    }
  }

  function removeProp(el: any, key: string) {
    if (key === "style") {
      el.removeAttribute("style");
    } else if (key === "className") {
      el.className = "";
    } else if (key in el) {
      try {
        el[key] = "";
      } catch {
        /* read-only */
      }
      el.removeAttribute(key);
    } else {
      el.removeAttribute(key);
    }
  }

  function setProp(el: any, key: string, value: any) {
    if (/^on/i.test(key)) return; // inline handlers are never honoured
    if (key === "style") {
      applyStyle(el, value);
      return;
    }
    if (key === "className") {
      el.className = value == null ? "" : String(value);
      return;
    }
    if (key === "dangerouslySetInnerHTML") return;
    if ((CONTROLLED as any)[key]) {
      applyControlled(el, key, value);
      return;
    }
    if ((key === "href" || key === "src") && isDangerousUrl(value)) return;
    if (typeof value === "boolean") {
      if (value) el.setAttribute(key, "");
      else el.removeAttribute(key);
      if (key in el) el[key] = value;
      return;
    }
    if (key in el && typeof el[key] !== "object") {
      try {
        el[key] = value;
        return;
      } catch {
        /* fall through to attribute */
      }
    }
    if (value == null) el.removeAttribute(key);
    else el.setAttribute(key, String(value));
  }

  function applyControlled(el: any, key: string, value: any) {
    if (key === "value") {
      if (el.__zushiComposing) return; // don't clobber IME composition
      const v = value == null ? "" : String(value);
      if (el.value !== v) el.value = v;
    } else if (key === "checked") {
      el.checked = !!value;
    }
  }

  function applyStyle(el: any, style: any) {
    el.style.cssText = "";
    if (style && typeof style === "object") {
      for (const k in style) {
        const v = style[k];
        if (v == null) continue;
        try {
          el.style[k] = typeof v === "number" ? v + "px" : String(v);
        } catch {
          /* invalid style prop */
        }
      }
    }
  }

  function isDangerousUrl(value: any): boolean {
    return typeof value === "string" && /^\s*javascript:/i.test(value);
  }

  // ---- events -----------------------------------------------------------

  function patchEvents(el: any, ev: any[]) {
    const map: Record<string, number> = {};
    for (let i = 0; i < ev.length; i++) map[ev[i].t] = ev[i].h;
    el.__zushiHid = map;

    if (!el.__zushiListeners) el.__zushiListeners = {};
    const listeners = el.__zushiListeners;

    for (const type in map) {
      if (!listeners[type]) {
        listeners[type] = makeListener(el, type);
        el.addEventListener(type, listeners[type]);
      }
    }
    for (const t2 in listeners) {
      if (!(t2 in map)) {
        el.removeEventListener(t2, listeners[t2]);
        delete listeners[t2];
      }
    }
  }

  function makeListener(el: any, type: string) {
    return function (e: any) {
      const hid = el.__zushiHid ? el.__zushiHid[type] : undefined;
      if (hid == null) return;
      parent.postMessage(
        {
          __zushi: MSG_EVENT,
          hid: hid,
          type: type,
          g: currentGen,
          payload: serializeEvent(e)
        },
        "*"
      );
    };
  }

  function serializeEvent(e: any): any {
    const t = e.target || {};
    return {
      value: t.value,
      checked: t.checked,
      key: e.key,
      code: e.code,
      targetId: t.id
    };
  }

  function attachComposition(el: any) {
    el.addEventListener("compositionstart", function () {
      el.__zushiComposing = true;
    });
    el.addEventListener("compositionend", function () {
      el.__zushiComposing = false;
    });
  }
}

const PATCHER_BODY =
  '<div id="__zushi_root"></div><script>(' +
  zushiPatcher.toString() +
  ")();</script>";

/** Full iframe document for the JSX patcher. Mounted once per surface. */
export const PATCHER_HTML =
  "<!doctype html><html><head><meta charset=\"utf-8\">" +
  "<style>*{box-sizing:border-box}html,body{margin:0;padding:0}</style>" +
  "</head><body>" +
  PATCHER_BODY +
  "</body></html>";
