# Concepts

## Architecture

```
untrusted plugin code
  └─ Backend (QuickJS built-in)  (Sandbox)       — runtime/
       └─ exposed host API        (merge)         — ui/ + your API
            └─ sandboxed iframe   (SafeIFrame)    — iframe/
                 └─ postMessage  ←→  host
```

| Module      | Key exports                               | Responsibility |
| ----------- | ----------------------------------------- | -------------- |
| `runtime/`  | `Sandbox`, `Backend`, `quickjs`           | Backend-agnostic lifecycle/messages/job loop; `QuickJSBackend` does VM expose/eval/pump |
| `iframe/`   | `SafeIFrame`                              | Sandboxed iframe, srcdoc injection, auto-resize, messages |
| `ui/`       | `UISurface`, `createConsole`              | Named UI surface API (`.api`) built on `SafeIFrame` |
| `events/`   | `events`, fingerprint helpers             | Typed event emitter (marshal-stable via function fingerprints) |
| `storage/`  | `ClientStorage`                           | Per-instance IndexedDB key-value store |
| `jsx/`      | `JsxHost`, `domRenderer`, `reactRenderer` | Opt-in in-VM JSX runtime + pluggable renderer (`jsx: true`) |
| top-level   | `Plugin`                                  | Creates host-declared UI surfaces + VM + default expose |
| `/react`    | `usePlugin`, `PluginView`                 | React adapter |

`Plugin` is the high-level orchestrator. Under it, `Sandbox` is the
backend-agnostic host (you can use it directly for non-UI use cases — see
[Backends](./backends.md#the-low-level-sandbox)).

## What crosses the boundary

The central rule: **only data crosses; code and live references do not.**

- Plugin → host: values marshaled by the backend. With QuickJS, primitives,
  plain objects/arrays, plain functions, `Date`, and `Promise` cross by
  reference; everything else (class instances, …) is deep-cloned **by value as
  JSON**, losing its prototype, methods, and identity. See
  [marshaling](./backends.md#marshaling).
- Host → plugin (UI): only serialized data trees and `postMessage` payloads.
  Plugin UI can't reach the host DOM. See [Surfaces & iframes](./surfaces.md).

This is what makes the [host-direct canvas renderer](./jsx/renderers.md) safe
and the [security model](./security.md) hold.

## The manual event loop

QuickJS has no built-in event loop. After host-side async work resolves (a
promise the plugin is awaiting, an incoming message), the VM's microtask/job
queue must be **pumped** so the plugin's continuations run.

- The `exposed` factory receives `startEventLoop()`; call it after you resolve
  async work the plugin is waiting on.
- `Sandbox` exposes `requestEventLoop()` for the same purpose.
- zushi pumps automatically after evaluating code and after incoming iframe
  messages; you mostly need `startEventLoop` for your own async host functions.

```ts
exposed: ({ startEventLoop }) => ({
  host: {
    fetchData: async (url: string) => {
      const data = await realFetch(url);
      startEventLoop();   // let the plugin's `await` continue
      return data;
    }
  }
})
```

Internally a backend's `pump()` drains one turn and reports whether more work
remains; the host re-schedules until the queue is empty.

## The message channel

Independent of UI surfaces, a plugin and host can exchange freeform messages:

- The `exposed` factory receives `messages` with `on(fn)`, `off(fn)`, and
  `once(fn)` — expose these so plugin code can listen.
- The host pushes a message in with `plugin.handleMessage(msg)` (or
  `sandbox.handleMessage`), which fans out to all current listeners (and clears
  `once` listeners).
- `PluginOptions.onMessage(msg)` fires for every message the host hands in —
  handy for logging/observability.

```ts
const plugin = new Plugin({
  backend: quickjs(),
  exposed: ({ messages }) => ({ host: { onMessage: messages.on } }),
  code: `host.onMessage((m) => reearth.console.log("got", m));`,
  onMessage: (m) => console.debug("message:", m)
});
await plugin.start();
plugin.handleMessage({ hello: "world" });
```

## Lifecycle callbacks

`PluginOptions` (and `SandboxOptions`) accept:

- `onPreInit()` — just before the VM is created (after source is fetched).
- `onError(err)` — any error during code evaluation or message dispatch.
  Defaults to `console.error`.
- `onMessage(msg)` — every message handed in via `handleMessage`.
- `onDispose()` — when `dispose()` is called.

`plugin.start()` is idempotent-safe against disposal: disposing before/while
starting aborts cleanly.
