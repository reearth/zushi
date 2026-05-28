/**
 * The JSX runtime that runs *inside* the QuickJS VM.
 *
 * It is authored as a single self-contained function and shipped as a source
 * string (see {@link VM_RUNTIME_SOURCE}) that the host evaluates in the VM
 * before the plugin code. Because it is serialized via
 * `Function.prototype.toString`, it must not reference anything from the outer
 * module scope — only VM globals and the host bridge `__zushi`.
 *
 * Responsibilities (all in-VM, so component calls cost no marshalling):
 *  - `createElement` / `jsx` build virtual nodes;
 *  - a reconciler resolves function components and runs hooks, with one
 *    independent root per surface (`ui` / `modal` / `popup`);
 *  - the result is serialized to an intrinsic-only tree (handlers replaced by
 *    integer ids held in a VM-local registry) and pushed to the host;
 *  - incoming events are dispatched back to the registered handlers.
 *
 * Custom components are registered (trusted) via `registerComponent`; only
 * markup produced *inside* a trusted component may use intrinsic HTML tags when
 * the host restricts intrinsics. Only plain JSON crosses to the host; handler
 * functions never leave the VM.
 */
function zushiVmRuntime() {
  // Must match FRAGMENT in ./protocol.ts.
  const FRAGMENT = "__zushi.Fragment";
  const g: any = globalThis;
  const bridge: any = g.__zushi;
  const config: any = (bridge && bridge.config) || {};
  // intrinsics policy: true (any), false (none), or array of allowed tags.
  const intrinsics: any = config.intrinsics === undefined ? true : config.intrinsics;

  const trusted = new WeakSet();
  let trustDepth = 0;

  // ---- vnode factories --------------------------------------------------

  function flatten(arr: any[]): any[] {
    let out: any[] = [];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (Array.isArray(v)) out = out.concat(flatten(v));
      else out.push(v);
    }
    return out;
  }

  // Classic runtime / pragma: createElement(type, props, ...children)
  function createElement(type: any, props: any, ...rest: any[]) {
    props = props || {};
    const children =
      rest.length > 0
        ? flatten(rest)
        : props.children != null
          ? flatten([props.children])
          : [];
    props.children = children; // expose to components as `props.children`
    return {
      type: type,
      props: props,
      children: children,
      key: props.key,
      _t: trustDepth > 0
    };
  }

  // Automatic runtime: jsx(type, { ...props, children }, key)
  function jsx(type: any, props: any, key: any) {
    props = props || {};
    const ch = props.children;
    const children = ch == null ? [] : Array.isArray(ch) ? flatten(ch) : [ch];
    props.children = children;
    return {
      type: type,
      props: props,
      children: children,
      key: key != null ? key : props.key,
      _t: trustDepth > 0
    };
  }

  /** Register a trusted custom component, also exposed as a global by name. */
  function registerComponent(name: string, fn: any) {
    if (typeof fn !== "function") return;
    trusted.add(fn);
    g[name] = fn;
  }

  function intrinsicAllowed(tag: string): boolean {
    if (intrinsics === true) return true;
    if (intrinsics === false) return false;
    if (Array.isArray(intrinsics)) return intrinsics.indexOf(tag) >= 0;
    return true;
  }

  // ---- hooks ------------------------------------------------------------

  let currentHooks: any[] | null = null;
  let currentHookIndex = 0;
  let currentPath = "";

  function getHook(init: any) {
    const hooks = currentHooks as any[];
    const i = currentHookIndex++;
    if (i >= hooks.length) hooks.push(init());
    return hooks[i];
  }

  function useState(initial: any) {
    const ownerRoot = active;
    const hook = getHook(function () {
      return { v: typeof initial === "function" ? initial() : initial };
    });
    function set(next: any) {
      const nv = typeof next === "function" ? next(hook.v) : next;
      if (!Object.is(nv, hook.v)) {
        hook.v = nv;
        requestRender(ownerRoot);
      }
    }
    return [hook.v, set];
  }

  function useReducer(reducer: any, initialArg: any, init: any) {
    const ownerRoot = active;
    const hook = getHook(function () {
      return { v: typeof init === "function" ? init(initialArg) : initialArg };
    });
    function dispatch(action: any) {
      const nv = reducer(hook.v, action);
      if (!Object.is(nv, hook.v)) {
        hook.v = nv;
        requestRender(ownerRoot);
      }
    }
    return [hook.v, dispatch];
  }

  function useId() {
    const slot = currentHookIndex;
    const base = currentPath;
    const hook = getHook(function () {
      return {
        id: "z-" + String(base).replace(/[^a-zA-Z0-9]/g, "_") + "-" + slot
      };
    });
    return hook.id;
  }

  function depsChanged(a: any[] | null, b: any[] | null): boolean {
    if (!a || !b) return true;
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return true;
    return false;
  }

  function useEffect(effect: any, deps: any) {
    const hook = getHook(function () {
      return { deps: undefined, cleanup: undefined };
    });
    const changed = deps === undefined || depsChanged(hook.deps, deps);
    if (changed) {
      active.pendingEffects.push({ hook: hook, effect: effect });
      hook.deps = deps;
    }
  }

  function useMemo(factory: any, deps: any) {
    const hook = getHook(function () {
      return { deps: undefined, value: undefined };
    });
    if (hook.deps === undefined || depsChanged(hook.deps, deps)) {
      hook.value = factory();
      hook.deps = deps;
    }
    return hook.value;
  }

  function useCallback(cb: any, deps: any) {
    return useMemo(function () {
      return cb;
    }, deps);
  }

  function useRef(initial: any) {
    return getHook(function () {
      return { current: initial };
    });
  }

  // Context: createContext returns an object whose `.Provider` is a marker
  // component. The reconciler detects providers and brackets the rendering of
  // their descendants with the value pushed on a stack, so useContext reads the
  // nearest enclosing value.
  function createContext(defaultValue: any) {
    const ctx: any = { _d: defaultValue, _s: [] };
    function Provider(props: any) {
      return props.children;
    }
    Provider._ctx = ctx;
    ctx.Provider = Provider;
    return ctx;
  }

  function useContext(ctx: any) {
    if (!ctx) return undefined;
    return ctx._s.length ? ctx._s[ctx._s.length - 1] : ctx._d;
  }

  // ---- per-surface roots ------------------------------------------------

  // Each surface ("ui" / "modal" / "popup") reconciles independently, with its
  // own generation, handler registry and component (hook) store.
  const roots: Record<string, any> = {};
  let active: any = null;

  function getRoot(id: string) {
    let r = roots[id];
    if (!r) {
      r = {
        id: id,
        rootElement: null,
        options: {},
        gen: 0,
        nextHid: 1,
        handlerRegistry: {},
        componentStore: {},
        visited: {},
        pendingEffects: [],
        scheduled: false
      };
      roots[id] = r;
    }
    return r;
  }

  function requestRender(root: any) {
    if (root.scheduled) return;
    root.scheduled = true;
    Promise.resolve().then(function () {
      root.scheduled = false;
      doRender(root);
    });
  }

  function render(element: any, options: any) {
    const opts = options || {};
    const id = opts.surface || "ui";
    const root = getRoot(id);
    root.rootElement = element;
    root.options = {
      visible: opts.visible,
      width: opts.width,
      height: opts.height
    };
    doRender(root);
  }

  function doRender(root: any) {
    if (root.rootElement == null || !bridge) return;
    const prev = active;
    active = root;
    root.gen++;
    root.nextHid = 1;
    root.handlerRegistry = {};
    root.visited = {};
    root.pendingEffects = [];

    let tree: any[];
    try {
      tree = renderChildren([root.rootElement], "0");
    } catch (err) {
      reportError(err);
      active = prev;
      return;
    }

    // Unmount: run cleanups for components not visited this render.
    for (const p in root.componentStore) {
      if (!root.visited[p]) {
        runCleanups(root.componentStore[p]);
        delete root.componentStore[p];
      }
    }

    bridge.render(root.id, { g: root.gen, tree: tree }, root.options);
    flushEffects(root);
    active = prev;
  }

  function flushEffects(root: any) {
    const effects = root.pendingEffects;
    root.pendingEffects = [];
    for (let i = 0; i < effects.length; i++) {
      const e = effects[i];
      if (typeof e.hook.cleanup === "function") {
        try {
          e.hook.cleanup();
        } catch (err) {
          reportError(err);
        }
      }
      try {
        const c = e.effect();
        e.hook.cleanup = typeof c === "function" ? c : undefined;
      } catch (err) {
        reportError(err);
      }
    }
  }

  function runCleanups(rec: any) {
    const hooks = rec.hooks || [];
    for (let i = 0; i < hooks.length; i++) {
      const h = hooks[i];
      if (h && typeof h.cleanup === "function") {
        try {
          h.cleanup();
        } catch (err) {
          reportError(err);
        }
      }
    }
  }

  function reportError(err: any) {
    if (g.console && g.console.error) g.console.error(err);
  }

  // ---- reconcile --------------------------------------------------------

  // Returns a flat array of serialized child nodes, splicing fragments in and
  // stamping keys for the patcher's keyed diff.
  function renderChildren(children: any[], path: string): any[] {
    const out: any[] = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const key = isVNode(child) && child.key != null ? child.key : undefined;
      const seg = key != null ? "$" + key : String(i);
      if (isVNode(child) && child.type === FRAGMENT) {
        const inner = renderChildren(child.children, path + "." + seg);
        for (let j = 0; j < inner.length; j++) out.push(inner[j]);
      } else {
        const n = renderNode(child, path + "." + seg);
        if (n != null) {
          if (key != null && n.t) n.k = key;
          out.push(n);
        }
      }
    }
    return out;
  }

  function isVNode(v: any): boolean {
    return (
      v != null &&
      typeof v === "object" &&
      "type" in v &&
      "props" in v &&
      "children" in v
    );
  }

  function renderNode(node: any, path: string): any {
    if (node == null || node === false || node === true || node === "")
      return null;
    if (typeof node === "string" || typeof node === "number")
      return { x: String(node) };
    if (!isVNode(node)) return { x: String(node) };

    const type = node.type;

    if (type === FRAGMENT) {
      return { t: "div", p: {}, ev: [], c: renderChildren(node.children, path) };
    }

    if (typeof type === "function") {
      return renderComponent(node, path);
    }

    const tag = String(type);
    if (!node._t && !intrinsicAllowed(tag)) {
      throw new Error(
        "zushi: intrinsic element <" +
          tag +
          "> is not allowed; render it through a registered component"
      );
    }

    const sp = serializeProps(node.props);
    return {
      t: tag,
      p: sp.p,
      ev: sp.ev,
      c: renderChildren(node.children, path)
    };
  }

  function renderComponent(node: any, path: string): any {
    // Context provider: bracket descendant rendering with the pushed value
    // instead of running a component body / allocating hooks.
    const ctx = node.type._ctx;
    if (ctx) {
      ctx._s.push(node.props ? node.props.value : undefined);
      let rendered: any[];
      try {
        rendered = renderChildren(node.children, path);
      } finally {
        ctx._s.pop();
      }
      if (rendered.length === 1) return rendered[0];
      return { t: "div", p: {}, ev: [], c: rendered };
    }

    active.visited[path] = true;
    let rec = active.componentStore[path];
    if (!rec) {
      rec = { hooks: [] };
      active.componentStore[path] = rec;
    }

    const isTrusted = trusted.has(node.type);
    const prevHooks = currentHooks;
    const prevIndex = currentHookIndex;
    const prevPath = currentPath;
    currentHooks = rec.hooks;
    currentHookIndex = 0;
    currentPath = path;
    if (isTrusted) trustDepth++;
    let output: any;
    try {
      output = node.type(node.props);
    } catch (err) {
      reportError(err);
      output = null;
    } finally {
      if (isTrusted) trustDepth--;
      currentHooks = prevHooks;
      currentHookIndex = prevIndex;
      currentPath = prevPath;
    }

    // A component renders to a single subtree; reuse renderChildren so the
    // output may itself be a fragment/array, but collapse to one node when it
    // is a single element (to keep DOM structure 1:1 with the JSX).
    const rendered = renderChildren([output], path + "|");
    if (rendered.length === 1) return rendered[0];
    return { t: "div", p: {}, ev: [], c: rendered };
  }

  function serializeProps(props: any): { p: any; ev: any[] } {
    const out: any = {};
    const ev: any[] = [];
    for (const k in props) {
      if (k === "children" || k === "key") continue;
      const v = props[k];
      if (/^on[A-Z]/.test(k) && typeof v === "function") {
        const type = k.slice(2).toLowerCase();
        const hid = active.nextHid++;
        active.handlerRegistry[hid] = v;
        ev.push({ t: type, h: hid });
      } else if (typeof v === "function") {
        // Non-event functions can't be serialized; drop them.
        continue;
      } else if (k === "style" && v && typeof v === "object") {
        out.style = v;
      } else {
        out[k] = v;
      }
    }
    return { p: out, ev: ev };
  }

  // ---- event dispatch (called by the host) ------------------------------

  function dispatch(
    surfaceId: string,
    hid: number,
    _type: string,
    payload: any,
    gen: number
  ) {
    const root = roots[surfaceId];
    if (!root || gen !== root.gen) return; // stale event / unknown surface
    const fn = root.handlerRegistry[hid];
    if (typeof fn === "function") {
      try {
        fn(payload);
      } catch (err) {
        reportError(err);
      }
    }
  }

  // ---- install globals + hand the host our dispatch fn ------------------

  g.createElement = createElement;
  g.h = createElement;
  g.Fragment = FRAGMENT;
  g.jsx = jsx;
  g.jsxs = jsx;
  g.jsxDEV = jsx;
  g.__zushi_jsx = jsx;
  g.__zushi_createElement = createElement;
  g.registerComponent = registerComponent;
  g.useState = useState;
  g.useReducer = useReducer;
  g.useEffect = useEffect;
  g.useLayoutEffect = useEffect; // no separate layout phase; same semantics
  g.useMemo = useMemo;
  g.useCallback = useCallback;
  g.useRef = useRef;
  g.useId = useId;
  g.createContext = createContext;
  g.useContext = useContext;
  g.render = render;

  if (bridge && typeof bridge.ready === "function") bridge.ready(dispatch);
}

/**
 * The JSX runtime as a source string, ready to be evaluated in the VM.
 * Wrapped in an IIFE so it installs its globals and registers its dispatch
 * function on load.
 */
export const VM_RUNTIME_SOURCE = "(" + zushiVmRuntime.toString() + ")();";
