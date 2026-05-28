# @reearth/zushi

A framework-agnostic plugin runtime for the browser. Run untrusted JavaScript in
a [QuickJS](https://github.com/justjake/quickjs-emscripten) (WASM) VM, expose a
host-defined API into it, and render plugin UI inside sandboxed `<iframe>`s.

Extracted and generalized from the plugin mechanism of
[Re:Earth Visualizer](https://github.com/reearth/reearth-visualizer).

> The name comes from _zushi_ (厨子), a small Japanese cabinet that enshrines a precious object behind doors you open only when needed — much like a host that encloses an external module and opens it to render on demand.

## Why

Running third-party plugin code safely in a web app needs two layers of
isolation:

1. **A JavaScript VM** ([QuickJS](https://github.com/justjake/quickjs-emscripten)
   via [`quickjs-emscripten-sync`](https://github.com/reearth/quickjs-emscripten-sync))
   so plugin logic never touches the host realm — no `window`, no `document`,
   no `fetch`, unless the host explicitly hands it over.
2. **Sandboxed iframes** (`sandbox="allow-scripts ..."`, no `allow-same-origin`)
   so plugin UI is rendered in an opaque origin and talks to the host only via
   `postMessage`.

zushi packages both layers plus the wiring between them, and lets you expose any
host API you like into the VM.

## Install

```sh
npm install @reearth/zushi
```

## Quick start

```ts
import { Plugin } from "@reearth/zushi";

const plugin = new Plugin({
  container: document.getElementById("plugin-ui")!,
  code: `
    // This runs inside the QuickJS VM. It has no DOM access.
    reearth.ui.show("<h1>Hello from a plugin</h1>");
    reearth.ui.on("message", (msg) => reearth.console.log("from iframe:", msg));
    host.greet("world");
  `,
  // Build the API exposed to plugin code. The default globals
  // (console, ui, modal, popup) are merged in automatically.
  exposed: ({ ui, modal, popup, messages, startEventLoop }) => ({
    reearth: { ui: ui.uiAPI, modal: modal.modalAPI, popup: popup.modalAPI },
    host: {
      greet: (name: string) => console.log(`plugin greeted ${name}`)
    }
  })
});

await plugin.start();
// ...later
plugin.dispose();
```

### Choosing a QuickJS variant (browsers/bundlers)

By default the VM loads via `getQuickJS()`, which fetches a separate `.wasm`
file. In a bundler/browser it's often easier to use a **singlefile** variant
that embeds the wasm, avoiding a separate fetch:

```ts
import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten";

const quickjs = newQuickJSWASMModuleFromVariant(variant);

const plugin = new Plugin({ container, code, quickjs }); // pass it through
```

### React

```tsx
import { PluginView } from "@reearth/zushi/react";

function MyPlugin() {
  return (
    <PluginView
      code={pluginSource}
      style={{ width: 320, height: 240 }}
      exposed={({ ui }) => ({ reearth: { ui: ui.uiAPI } })}
    />
  );
}
```

Or use the hook directly:

```tsx
import { usePlugin } from "@reearth/zushi/react";

function MyPlugin() {
  const { containerRef, getPlugin } = usePlugin({ code: pluginSource });
  return <div ref={containerRef} />;
}
```

## JSX UI (opt-in)

Instead of pushing HTML strings with `ui.show(...)`, plugins can build UI
declaratively with a small React-like runtime that runs **inside the VM**. Pass
`jsx: true` to enable it; it's off by default and doesn't affect `ui.show`.

```ts
const plugin = new Plugin({
  container,
  jsx: true,
  code: `
    function Counter() {
      const [n, setN] = useState(0);
      return h("button", { onClick: () => setN(n + 1) }, "count: " + n);
    }
    render(h(Counter));   // mounts into the main UI iframe
  `
});
```

- **Hooks**: `useState`, `useReducer`, `useEffect`, `useLayoutEffect`,
  `useMemo`, `useCallback`, `useRef`, `useId`, and `createContext` /
  `useContext`.
- **Reconciliation runs in the VM**: components and hooks are resolved to an
  intrinsic-only tree there (no per-node marshalling); only plain JSON crosses
  to the host. Event handlers never leave the VM — they're referenced by id and
  invoked when the iframe reports a DOM event. A tiny patcher in the iframe
  diffs (keyed) and patches real DOM, so input focus/caret survive re-renders.
- **Surfaces**: `render(el, { surface: "modal" })` (or `"popup"`) targets the
  other iframes; each reconciles independently.

### Writing JSX

zushi doesn't transpile JSX — it only ships the runtime functions. Wire them up
whichever way your build prefers:

```ts
// 1) Classic pragma — no imports, uses the VM globals.
/** @jsx createElement */
/** @jsxFrag Fragment */

// 2) Automatic runtime — set jsxImportSource to "@reearth/zushi"
//    (tsconfig / esbuild / vite). Resolves to @reearth/zushi/jsx-runtime.

// 3) Explicit import (for bundled plugins).
import { render, useState, createElement, Fragment } from "@reearth/zushi/jsx";
```

All three produce the same `createElement` calls and run against the in-VM
runtime; for plugins evaluated as a raw source string, the names are also
available as bare globals.

### Custom components & restricting HTML

The host can register trusted custom components (à la Figma's `View`/`Text`) and
optionally forbid raw HTML in plugin code, so plugins are confined to a curated
component vocabulary:

```ts
new Plugin({
  jsx: true,
  intrinsics: false, // plugins may not use raw HTML tags…
  components: `
    // …but trusted components, run in the VM before the plugin, may.
    registerComponent("View", (p) =>
      h("div", { style: { display: "flex", gap: p.gap, ...p.style } }, p.children));
    registerComponent("Text", (p) => h("span", { style: p.style }, p.children));
  `,
  code: `render(h(View, { gap: 8 }, h(Text, null, "hello")));`
});
```

`intrinsics` accepts `true` (any tag, default), `false` (none), or an allowlist
of tag names. Tags emitted *inside* a registered component are always allowed.

## Architecture

```
untrusted plugin code
  └─ QuickJS WASM VM            (Sandbox)        — runtime/
       └─ exposed host API      (merge)          — ui/ + your API
            └─ sandboxed iframe (SafeIFrame)     — iframe/
                 └─ postMessage  ←→  host
```

| Module      | Export                          | Responsibility                                            |
| ----------- | ------------------------------- | --------------------------------------------------------- |
| `runtime/`  | `Sandbox`                       | QuickJS VM lifecycle, expose, eval, job loop, dispose     |
| `iframe/`   | `SafeIFrame`                    | Sandboxed iframe, srcdoc injection, auto-resize, messages |
| `ui/`       | `UISurface`, `createConsole`    | `ui`/`modal`/`popup` API built on `SafeIFrame`            |
| `events/`   | `events`, `mergeEvents`         | Typed event emitter (QuickJS-marshal-stable via fingerprint) |
| `storage/`  | `ClientStorage`                 | Per-instance IndexedDB key-value store                    |
| `jsx/`      | `VM_RUNTIME_SOURCE`, `JsxHost`  | Opt-in in-VM JSX runtime + iframe DOM patcher (`jsx: true`) |
| top-level   | `Plugin`                        | Orchestrates the three UI surfaces + VM + default expose  |
| `/react`    | `usePlugin`, `PluginView`      | React adapter                                             |

## Security model

- Plugin code runs in QuickJS and cannot reach host globals (`window`,
  `document`, `fetch`, `process`, …). The `Function` constructor inside the VM
  yields the VM's global, not the host's.
- Only values allowed by `defaultIsMarshalable` (primitives, plain objects,
  arrays, plain functions, `Date`, `Promise`) cross by reference. Everything
  else is deep-cloned **by value as JSON** — so class instances lose their
  prototype, methods, and live reference at the boundary.
- Prototype pollution inside the VM does not affect the host realm.
- Iframes use `sandbox="allow-scripts allow-downloads allow-popups"` (no
  `allow-same-origin`) and incoming messages are verified by `event.source`.

See [`src/security.test.ts`](./src/security.test.ts) for the escape tests.

## Examples

```sh
pnpm example   # Vite dev server: React (<PluginView>) + vanilla + JSX runtime
```

See [`examples/`](./examples). The example's plugin lives in a shared module
([`examples/src/pluginSource.ts`](./examples/src/pluginSource.ts)) that is also
driven by a real-browser regression test
([`examples/regression.browser.test.ts`](./examples/regression.browser.test.ts)) —
so the example doubles as an end-to-end regression of the whole pipeline.

## Testing

- `pnpm test` — unit/logic tests in jsdom (VM behavior is real QuickJS; iframe
  DOM behavior is stubbed).
- `pnpm test:browser` — real-browser tests (Vitest browser mode / Playwright
  Chromium) that actually load iframe `srcdoc`, run injected scripts, exchange
  real `postMessage`s, exercise `ResizeObserver` auto-resize, verify sandbox
  isolation, and run the example end-to-end. Requires `npx playwright install
  chromium` once.
- `pnpm test:all` — both.

## License

MIT
