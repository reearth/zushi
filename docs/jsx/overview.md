# JSX UI (opt-in)

Instead of pushing HTML strings with `ui.show(...)`, plugins can build UI
declaratively with a small React-like runtime that runs **inside the VM**. Pass
`jsx: true` to enable it; it's off by default and doesn't affect `ui.show`. It
requires a JavaScript [backend](../backends.md).

By default the runtime API lands in a `zushi` namespace object in plugin scope
(see [Runtime API placement](./placement.md) to change this):

```ts
new Plugin({
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

## What's available

- **Hooks**: `useState`, `useReducer`, `useEffect`, `useLayoutEffect` (alias of
  `useEffect` — there's no separate layout phase in the VM), `useMemo`,
  `useCallback`, `useRef`, `useId`, `createContext` / `useContext`.
- **Also**: `memo(Component, areEqual?)`, an `ErrorBoundary`
  (`{ fallback, onError }`), and a basic `Suspense` (`{ fallback }`) that shows
  the fallback while a child throws a thenable and re-renders when it settles.
  There is no `lazy()` — the VM has no module loader.
- `h` / `createElement`, `Fragment`, `render`.

`render(el, { surface, visible, width, height })` mounts into a surface.
Without `surface` it targets the surface named `"ui"` (or the only one declared
if there's a single surface under another name). Each surface reconciles
independently.

## How it works (and why it's safe)

- **Reconciliation runs in the VM.** Components and hooks are resolved there into
  a serialized, intrinsic-only tree (no per-node marshaling). Only plain JSON
  crosses to the host.
- **Handlers never leave the VM.** Each event handler is replaced by an integer
  **handler id** (`hid`) in the serialized tree; the host references it by id.
- **Generations.** Every render bumps a generation number (`g`). When the host
  reports an event it includes the generation it came from, so stale handlers
  (from a superseded render) are dropped.
- **Only a safe event subset crosses back.** A reported event carries a curated
  `SerializedEvent` (`value`, `checked`, `key`, `code`, `targetId`) — never the
  full DOM event.
- A [renderer](./renderers.md) turns the serialized tree into something visible
  (HTML DOM by default; canvas, etc. opt-in). The DOM patcher diffs keyed +
  positionally and preserves input focus/caret and IME composition across
  re-renders.

## Writing JSX

zushi doesn't transpile JSX — it ships the runtime functions. Wire your build up
whichever way you prefer, pointing it at wherever you
[placed the API](./placement.md):

```ts
// 1) Classic pragma — point it at your placement (default namespace shown).
/** @jsx zushi.createElement */
/** @jsxFrag zushi.Fragment */

// 2) Automatic runtime — set jsxImportSource to "@reearth/zushi"
//    (tsconfig / esbuild / vite). Resolves to @reearth/zushi/jsx-runtime.

// 3) Explicit import (for bundled plugins).
import { render, useState, createElement, Fragment } from "@reearth/zushi/jsx";
```

All three produce the same `createElement` calls against the in-VM runtime. The
**automatic runtime** and the **explicit import** are placement-independent (they
use internal wiring); the **classic pragma** and **bare destructuring** must
match where you placed the API.

`Fragment` is the literal string `"__zushi.Fragment"` (not a Symbol), so it
survives VM marshaling and bundling — identity is by value.

## Next

- [Runtime API placement](./placement.md) — where `useState` & co. land, and the `setup` slot
- [Components & intrinsics](./components.md) — curated component vocabularies, restricting HTML
- [Renderers](./renderers.md) — draw to canvas instead of DOM
