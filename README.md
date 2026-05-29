# zushi

A framework-agnostic plugin runtime for the browser. Run untrusted plugin code
in an isolated WASM **backend** — a built-in [QuickJS](https://github.com/justjake/quickjs-emscripten)
backend runs JavaScript, with room for other guest languages — expose a
host-defined API into it, and render plugin UI inside sandboxed `<iframe>`s.

> The name comes from _zushi_ (厨子), a small Japanese cabinet that enshrines a precious object behind doors you open only when needed — much like a host that encloses an external module and opens it to render on demand.

## Why

Running third-party plugin code safely in a web app needs two layers of
isolation:

1. **A language VM** behind a pluggable `Backend` you choose explicitly. The
   built-in one is [QuickJS](https://github.com/justjake/quickjs-emscripten) (via
   [`quickjs-emscripten-sync`](https://github.com/reearth/quickjs-emscripten-sync))
   for JavaScript, so plugin logic never touches the host realm — no `window`,
   no `document`, no `fetch`, unless the host explicitly hands it over. Other
   WASM runtimes (e.g. a Python VM) can implement the same `Backend` interface.
2. **Sandboxed iframes** (`sandbox="allow-scripts ..."`, no `allow-same-origin`)
   so plugin UI is rendered in an opaque origin and talks to the host only via
   `postMessage`.

zushi packages both layers plus the wiring between them, and lets you expose any
host API you like into the backend.

## Install

```sh
npm install @reearth/zushi
```

## Quick start

```ts
import { Plugin, quickjs } from "@reearth/zushi";

const plugin = new Plugin({
  // Choose the execution backend explicitly. `quickjs()` runs plugin code in a
  // QuickJS (WASM) JavaScript VM.
  backend: quickjs(),
  // Declare the UI surfaces you want. None are created by default; each gets a
  // sandboxed iframe. Omit `container` for off-screen surfaces (e.g. a modal).
  surfaces: {
    main: { container: document.getElementById("plugin-ui")! },
    dialog: {}
  },
  code: `
    // This runs inside the QuickJS VM. It has no DOM access.
    reearth.ui.show("<h1>Hello from a plugin</h1>");
    reearth.ui.on("message", (msg) => reearth.console.log("from iframe:", msg));
    host.greet("world");
  `,
  // Build the API exposed to plugin code. Only `console` is provided by
  // default; you wire surfaces up under whatever names you like.
  exposed: ({ surfaces, messages, startEventLoop }) => ({
    reearth: {
      ui: surfaces.main.api,
      modal: surfaces.dialog.api,
      messages,
      startEventLoop
    },
    host: {
      greet: (name: string) => console.log(`plugin greeted ${name}`)
    }
  })
});

await plugin.start();
// ...later
plugin.dispose();
```

### Backends

Plugin code runs inside a pluggable **backend**, which you choose explicitly
via the required `backend` option. `quickjs()` runs JavaScript in a QuickJS
(WASM) VM; in the future, another guest runtime (e.g. a Python WASM VM) can
implement the same `Backend` interface and be dropped in here.

QuickJS-specific options (the WASM module/variant, marshaling rules) live on
the `quickjs()` factory rather than on `Plugin` directly:

```ts
import { Plugin, quickjs } from "@reearth/zushi";

const plugin = new Plugin({
  surfaces,
  code,
  backend: quickjs({ isMarshalable: "json" })
});
```

#### Choosing a QuickJS variant (browsers/bundlers)

By default the VM loads via `getQuickJS()`, which fetches a separate `.wasm`
file. In a bundler/browser it's often easier to use a **singlefile** variant
that embeds the wasm, avoiding a separate fetch — pass it as the backend's
`module`:

```ts
import { Plugin, quickjs } from "@reearth/zushi";
import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten";

const module = newQuickJSWASMModuleFromVariant(variant);

const plugin = new Plugin({
  surfaces,
  code,
  backend: quickjs({ module })
});
```

### React

`PluginView` mounts one element and hosts a surface named `"ui"` in it (rename
via the `surface` prop; declare extra off-screen surfaces via `surfaces`).

```tsx
import { PluginView } from "@reearth/zushi/react";
import { quickjs } from "@reearth/zushi";

function MyPlugin() {
  return (
    <PluginView
      backend={quickjs()}
      code={pluginSource}
      style={{ width: 320, height: 240 }}
      exposed={({ surfaces }) => ({ reearth: { ui: surfaces.ui.api } })}
    />
  );
}
```

Or use the hook directly:

```tsx
import { usePlugin } from "@reearth/zushi/react";
import { quickjs } from "@reearth/zushi";

function MyPlugin() {
  const { containerRef, getPlugin } = usePlugin({
    backend: quickjs(),
    code: pluginSource
  });
  return <div ref={containerRef} />;
}
```

## JSX UI (opt-in)

Instead of pushing HTML strings with `ui.show(...)`, plugins can build UI
declaratively with a small React-like runtime that runs **inside the VM**. Pass
`jsx: true` to enable it; it's off by default and doesn't affect `ui.show`.

By default the runtime API lands in a `zushi` namespace object in plugin scope
(see [Where the runtime API lands](#where-the-runtime-api-lands) to change this):

```ts
const plugin = new Plugin({
  backend: quickjs(),
  jsx: true,
  surfaces: { ui: { container } },
  code: `
    const { useState, h, render } = zushi;
    function Counter() {
      const [n, setN] = useState(0);
      return h("button", { onClick: () => setN(n + 1) }, "count: " + n);
    }
    render(h(Counter));   // mounts into the "ui" surface by default
  `
});
```

- **Hooks**: `useState`, `useReducer`, `useEffect`, `useLayoutEffect`,
  `useMemo`, `useCallback`, `useRef`, `useId`, and `createContext` /
  `useContext`.
- **Also**: `memo(Component, areEqual?)`, an `ErrorBoundary`
  (`{ fallback, onError }`), and a basic `Suspense` (`{ fallback }`) that shows
  the fallback while a child throws a thenable and re-renders when it settles
  (no `lazy()` — the VM has no module loader).
- **Reconciliation runs in the VM**: components and hooks are resolved to an
  intrinsic-only tree there (no per-node marshalling); only plain JSON crosses
  to the host. Event handlers never leave the VM — they're referenced by id and
  invoked when the iframe reports a DOM event. A tiny patcher in the iframe
  diffs (keyed) and patches real DOM, so input focus/caret survive re-renders.
- **Surfaces**: `render(el, { surface: "dialog" })` targets another declared
  surface by name; each reconciles independently. Without `surface` it renders
  into the surface named `"ui"` (or the only one declared).

### Where the runtime API lands

The host controls exactly how the runtime API (`useState`, `h`, `render`, …) is
planted into plugin scope — there are no fixed bare globals. Three ways, from
defaults to full control:

```ts
// 1) Default — a namespace object named "zushi".
new Plugin({ jsx: true, /* … */ });
//   plugin code: const { useState, render } = zushi;

// 2) Pick the namespace, or `false` for bare globals.
new Plugin({ jsx: true, namespace: "reearth" }); //   reearth.useState, …
new Plugin({ jsx: true, namespace: false });     //   bare: useState, render, …

// 3) `runtime` refs — place each function anywhere in your exposed tree.
new Plugin({
  jsx: true,
  exposed: ({ surfaces, runtime }) => ({
    reearth: {
      ui: surfaces.ui.api,          // host value (marshaled)
      useState: runtime.useState,   // runtime ref → resolved in the VM
      render: runtime.render
    }
  })
  //   plugin code: reearth.useState(…), reearth.render(…)
});
```

Placing any `runtime` ref turns off the default `namespace` placement — you own
the layout. Refs are opaque tokens that never cross into the VM; zushi pulls
them out of the exposed tree and the in-VM runtime installs the real functions
at those paths, sitting right alongside your marshaled host values.

You can also wire everything by hand from the trusted [`setup`](#the-setup-slot)
slot, and seal the bridge afterward:

```ts
new Plugin({
  jsx: true,
  namespace: false,                 // don't auto-plant anything
  setup: `
    // The full runtime is in scope here as bare names (and as __zushi.runtime).
    globalThis.widget = { useState, h, render, AutoLayout: View };
  `
  // __zushi is deleted after setup by default, so plugin code can't reach the
  // host bridge — pass exposeBridge: true to keep it.
});
```

### Writing JSX

zushi doesn't transpile JSX — it only ships the runtime functions. Wire them up
whichever way your build prefers (point the pragma/import at wherever you placed
the API):

```ts
// 1) Classic pragma — point it at your placement (default namespace shown).
/** @jsx zushi.createElement */
/** @jsxFrag zushi.Fragment */

// 2) Automatic runtime — set jsxImportSource to "@reearth/zushi"
//    (tsconfig / esbuild / vite). Resolves to @reearth/zushi/jsx-runtime.
//    Works regardless of placement (it uses an internal wiring).

// 3) Explicit import (for bundled plugins). Also placement-independent.
import { render, useState, createElement, Fragment } from "@reearth/zushi/jsx";
```

All three produce the same `createElement` calls and run against the in-VM
runtime. The automatic runtime and the explicit import are placement-independent;
the classic pragma and bare destructuring must match where you placed the API.

### Custom components & restricting HTML

The host can register trusted custom components (à la Figma's `View`/`Text`) and
optionally forbid raw HTML in plugin code, so plugins are confined to a curated
component vocabulary:

```ts
new Plugin({
  backend: quickjs(),
  jsx: true,
  surfaces: { ui: { container } },
  intrinsics: false, // plugins may not use raw HTML tags…
  setup: `
    // …but trusted components, run in the VM before the plugin, may.
    registerComponent("View", (p) =>
      h("div", { style: { display: "flex", gap: p.gap, ...p.style } }, p.children));
    registerComponent("Text", (p) => h("span", { style: p.style }, p.children));
  `,
  code: `
    const { h, render } = zushi;     // registered View/Text are bare globals
    render(h(View, { gap: 8 }, h(Text, null, "hello")));
  `
});
```

`intrinsics` accepts `true` (any tag, default), `false` (none), or an allowlist
of tag names. Tags emitted *inside* a registered component are always allowed.
Registered components are exposed as bare globals by name (e.g. `View`), so
plugin code uses them directly regardless of where the runtime API is placed.

#### The `setup` slot

`setup` is a trusted JS source evaluated in the VM **after** the JSX runtime and
**before** the plugin. Components registered here via `registerComponent` are
marked trusted, so the markup they emit may use intrinsic tags even when
`intrinsics` forbids them in plugin code.

The full JSX runtime is in scope inside `setup` as **bare names** — including
`registerComponent` — regardless of where it was placed for plugin code (setup
runs inside `with (__zushi.runtime)`). The same bundle is reachable as
`__zushi.runtime` for explicit wiring:

- `registerComponent` (setup only by default)
- `h` / `createElement`, `Fragment`, `render`
- hooks — `useState`, `useReducer`, `useEffect`, `useLayoutEffect`, `useMemo`,
  `useCallback`, `useRef`, `useId`, `createContext`, `useContext`
- `memo`, `ErrorBoundary`, `Suspense`

`registerComponent` is **not** included in the default placement, so plugin code
can't register (and so can't grant itself the intrinsic-tag privilege) — only
`setup` can. Set `exposeRegisterComponent: true` to include it in the placement
for plugin code too. After `setup` runs, the `__zushi` bridge is deleted from
the VM globals so plugin code can't reach the host internals; pass
`exposeBridge: true` to keep it. (The runtime functions keep working — they
capture the bridge in a closure.)

### React-library compatibility (experimental)

This is a React-*like* runtime, not React. Third-party libraries that import
from `"react"` won't bind to it by default. As a best-effort escape hatch,
alias your bundler's `"react"` to `@reearth/zushi/react-compat` (and set
`jsxImportSource` to `"@reearth/zushi"`); *headless* libraries that only use
hooks and elements may then run inside the VM. Anything touching `react-dom`,
real DOM refs, portals, or concurrent features will not work — treat this as a
subset, not full compatibility.

## Architecture

```
untrusted plugin code
  └─ Backend (QuickJS built-in)  (Sandbox)       — runtime/
       └─ exposed host API      (merge)          — ui/ + your API
            └─ sandboxed iframe (SafeIFrame)     — iframe/
                 └─ postMessage  ←→  host
```

| Module      | Export                          | Responsibility                                            |
| ----------- | ------------------------------- | --------------------------------------------------------- |
| `runtime/`  | `Sandbox`, `Backend`, `quickjs` | Backend-agnostic lifecycle/messages/job loop; `QuickJSBackend` does VM expose/eval/pump |
| `iframe/`   | `SafeIFrame`                    | Sandboxed iframe, srcdoc injection, auto-resize, messages |
| `ui/`       | `UISurface`, `createConsole`    | Named UI surface API (`.api`) built on `SafeIFrame`       |
| `events/`   | `events`, `mergeEvents`         | Typed event emitter (QuickJS-marshal-stable via fingerprint) |
| `storage/`  | `ClientStorage`                 | Per-instance IndexedDB key-value store                    |
| `jsx/`      | `VM_RUNTIME_SOURCE`, `JsxHost`  | Opt-in in-VM JSX runtime + iframe DOM patcher (`jsx: true`) |
| top-level   | `Plugin`                        | Creates host-declared UI surfaces + VM + default expose   |
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
