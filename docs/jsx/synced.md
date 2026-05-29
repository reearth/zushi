# Synced state

`useState` lives in VM memory: it's local to a component, lost on dispose, and
invisible to the host. **Synced state** is the opposite — it lives in a
host-owned store outside the VM, so it:

- is **shared** across all of a plugin's surfaces,
- can be **read, written, and observed by the host** (`plugin.synced`),
- **survives dispose**, and can **persist across reloads** (IndexedDB),
- and re-renders the plugin whenever it changes (from either side).

It's modeled on Figma's `useSyncedState` / `useSyncedMap`.

## `useSyncedState`

Like `useState`, but keyed into the shared store:

```ts
new Plugin({
  backend: quickjs(),
  jsx: true,
  surfaces: { ui: { container } },
  synced: { initial: { count: 0 } },   // optional seed
  code: `
    const { useSyncedState, h, render } = zushi;
    function Counter() {
      const [n, setN] = useSyncedState("count", 0);
      return h("button", { onClick: () => setN(n + 1) }, "count: " + n);
    }
    render(h(Counter));
  `
});
```

`useSyncedState(key, initial)` returns `[value, setValue]`. The `key` namespaces
the value in the shared store; `initial` is the fallback until something is set.
`setValue` accepts a value or an updater `(prev) => next`.

## `useSyncedMap`

A synced last-writer-wins map stored under one name — handy for keyed
collections:

```ts
const items = useSyncedMap("items");
items.set("a", 1);
items.get("a");        // 1
items.has("a");        // true
items.delete("a");
items.keys();          // string[]
items.values();        // unknown[]
items.entries();       // [string, unknown][]
items.size;            // number
```

Mutations write a new object through the store, so reads stay reactive.

## The host side: `plugin.synced`

When `jsx` is enabled, `plugin.synced` is the same store — the host can drive and
observe it, so host UI and the plugin share one state:

```ts
plugin.synced!.get("count");           // read
plugin.synced!.set("count", 5);        // write → plugin re-renders
plugin.synced!.delete("count");
plugin.synced!.keys();                 // string[]
const off = plugin.synced!.subscribe((key, value) => { /* on any change */ });
```

## Configuration & persistence

The `synced` plugin option configures the store:

```ts
synced: {
  initial?: Record<string, unknown>;   // seed values
  persist?: boolean;                    // persist across reloads
  storage?: ClientStorage;              // backing store (default: a new one)
  instanceId?: string;                  // namespaces persisted keys (default "default")
  onChange?: (key, value) => void;      // observe every change
}
```

With `persist: true`, values are written through to IndexedDB (via
[`ClientStorage`](../storage-and-events.md#clientstorage)) and **loaded back
into memory before the plugin runs** (`Plugin.start()` awaits hydration), so the
first render sees persisted values. Use `instanceId` to scope one plugin
instance's state.

## Notes

- Values must be **plain data** — they cross the VM boundary and may be
  persisted, so functions and class instances won't round-trip.
- Synced state is a JSX-runtime feature (`jsx: true`); the hooks are placed like
  any other runtime API (see [placement](./placement.md)).
- vs `useState`: reach for synced state when the value must outlive a render
  tree, be shared with the host, or persist; use plain `useState` for transient
  view state.
