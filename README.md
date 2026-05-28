# @reearth/niche

A framework-agnostic plugin runtime for the browser. Run untrusted JavaScript in
a [QuickJS](https://github.com/justjake/quickjs-emscripten) (WASM) VM, expose a
host-defined API into it, and render plugin UI inside sandboxed `<iframe>`s.

Extracted and generalized from the plugin mechanism of
[Re:Earth Visualizer](https://github.com/reearth/reearth-visualizer).

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

niche packages both layers plus the wiring between them, and lets you expose any
host API you like into the VM.

## Install

```sh
npm install @reearth/niche
```

## Quick start

```ts
import { Plugin } from "@reearth/niche";

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

### React

```tsx
import { NichePlugin } from "@reearth/niche/react";

function MyPlugin() {
  return (
    <NichePlugin
      code={pluginSource}
      style={{ width: 320, height: 240 }}
      exposed={({ ui }) => ({ reearth: { ui: ui.uiAPI } })}
    />
  );
}
```

Or use the hook directly:

```tsx
import { usePlugin } from "@reearth/niche/react";

function MyPlugin() {
  const { containerRef, getPlugin } = usePlugin({ code: pluginSource });
  return <div ref={containerRef} />;
}
```

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
| top-level   | `Plugin`                        | Orchestrates the three UI surfaces + VM + default expose  |
| `/react`    | `usePlugin`, `NichePlugin`      | React adapter                                             |

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

## Testing

- `pnpm test` — unit/logic tests in jsdom (VM behavior is real QuickJS; iframe
  DOM behavior is stubbed).
- `pnpm test:browser` — real-browser tests (Vitest browser mode / Playwright
  Chromium) that actually load iframe `srcdoc`, run injected scripts, exchange
  real `postMessage`s, exercise `ResizeObserver` auto-resize, and verify the
  sandbox isolation. Requires `npx playwright install chromium` once.
- `pnpm test:all` — both.

## License

MIT
