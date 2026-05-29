# Exposing a host API

The `exposed` factory builds the global object tree the plugin sees. It returns
a plain object whose top-level keys become globals in the VM; values are
[marshaled](./backends.md#marshaling) across the boundary.

```ts
new Plugin({
  backend: quickjs(),
  surfaces: { main: { container } },
  exposed: ({ surfaces, messages, startEventLoop, runtime }) => ({
    reearth: {
      ui: surfaces.main.api,
      messages,
      startEventLoop
    },
    host: {
      greet: (name: string) => console.log(`hi ${name}`)
    }
  }),
  code: `reearth.ui.show("<h1>hi</h1>"); host.greet("world");`
});
```

## The factory context (`PluginContext`)

- `surfaces` — the declared [surfaces](./surfaces.md), keyed by name. Wire
  `surfaces.x.api` into your tree under whatever names you choose.
- `messages` — the host↔plugin [message channel](./concepts.md#the-message-channel)
  (`on` / `off` / `once`).
- `startEventLoop` — pump the VM [job loop](./concepts.md#the-manual-event-loop)
  after your async host functions resolve.
- `runtime` — JSX [runtime-placement](./jsx/placement.md) ref tokens (only
  meaningful with `jsx: true`).

(The low-level `Sandbox` passes just `{ messages, startEventLoop }` — a
`SandboxBridge`.)

## The built-in `console`

A `console` is **always merged into the globals before your `exposed` result** —
so `console.log/error/warn/info` work in plugin code out of the box (and you can
re-expose it under your own namespace, e.g. `reearth.console`). It's a safe
wrapper (`createConsole()`), not the host `console` object.

Your `exposed` tree is merged onto this default with [`merge`](#merge) — your
keys win, but `console` remains unless you override it.

## `merge`

`merge(base, override)` is the shallow-recursive merge zushi uses to combine the
default `{ console }` with your `exposed` result (plain objects are merged
recursively; everything else is replaced, override wins). It's exported for your
own use.

## Marshaling reminder

Functions you expose are callable from the plugin; their return values marshal
back. Class instances you return cross as **JSON value clones** by default (no
methods, no prototype, no live reference) — see
[marshaling](./backends.md#marshaling). Design exposed APIs around plain data
and functions.
