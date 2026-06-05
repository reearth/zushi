# JSX runtime API reference

The functions the in-VM JSX runtime exposes to plugin code (`jsx: true`). Where
they land in plugin scope — `zushi.useState`, bare, custom — is up to the host;
see [placement](./placement.md). All entries below are also importable from
`@reearth/zushi/jsx` for bundled plugins.

Behavior is React-*like* but VM-local: reconciliation and hooks run inside the
VM, and only a serialized tree crosses to the host (see
[overview](./overview.md#how-it-works-and-why-its-safe)).

## Elements

### `createElement(type, props?, ...children)` · `h`

Create a virtual node. `type` is an intrinsic tag name (string), a component
function, or `Fragment`. `h` is an alias. Returns a `VNode`.

```ts
h("div", { className: "row" }, h("span", null, "hi"))
```

### `Fragment`

Groups children without a wrapper element. It's the literal string
`"__zushi.Fragment"` (so it survives marshaling/bundling), used as a `type`.

## Surfaces

### `surface(name?)`

Look up a surface handle by name; with no argument it returns the host's default
surface (`"ui"` when declared, else the only one). Throws on an unknown name.
Each declared surface is also exposed directly by name — `zushi.ui`,
`zushi.modal`, … — so `surface()` is mostly for dynamic lookup.

### Surface handles — `ui.render`, `ui.resize`, `ui.show`, `ui.hide`

```ts
ui.render(element, {
  visible?: boolean,
  width?: number | string,
  height?: number | string
})
ui.resize(width?, height?)
ui.show()
ui.hide()
```

`render` mounts an element tree into the surface and starts reconciling it.
`resize` / `show` / `hide` drive the mounted surface afterwards (with a
host-direct [renderer](./renderers.md), visibility is the host's call and only
`resize` is honored).

## State

### `useState(initial)`

```ts
const [value, setValue] = useState(initial /* value | () => value */);
setValue(next);            // value | (prev) => next
```
VM-local, per-component, ephemeral. Updates re-render when the value changes
(compared with `Object.is`).

### `useReducer(reducer, initialArg, init?)`

```ts
const [state, dispatch] = useReducer((state, action) => next, initialArg, init?);
```

### `useRef(initial)`

```ts
const ref = useRef(initial); // { current }, stable across renders, no re-render on change
```

### Synced state — `useSyncedState`, `useSyncedMap`

State that lives in the host-owned store instead of VM memory (shared across
surfaces, host-drivable, optionally persisted). Full docs:
**[Synced state](./synced.md)**.

```ts
const [n, setN] = useSyncedState("count", 0);
const map = useSyncedMap("items"); // get/has/set/delete/keys/values/entries/size
```

## Effects

### `useEffect(effect, deps?)`

```ts
useEffect(() => {
  // run after render (when deps change, or every render if deps omitted)
  return () => { /* cleanup before next run / on unmount */ };
}, [a, b]);
```
Deps are compared with `Object.is`.

### `useLayoutEffect(effect, deps?)`

An **alias of `useEffect`** — there's no separate layout phase in the VM.

## Memoization

### `useMemo(factory, deps?)` · `useCallback(cb, deps?)`

```ts
const value = useMemo(() => compute(a), [a]);
const cb = useCallback(() => doThing(a), [a]); // === useMemo(() => cb, deps)
```

### `memo(Component, areEqual?)`

Wrap a component so it re-uses its last render when props are shallow-equal (and
its own state hasn't changed). `areEqual(prev, next)` overrides the comparison.

## Context

### `createContext(defaultValue)` · `useContext(context)`

```ts
const Ctx = createContext(defaultValue);
ui.render(h(Ctx.Provider, { value }, children));
const value = useContext(Ctx); // nearest enclosing Provider value, else default
```

## Misc

### `useId()`

Returns a stable, per-component-instance id string (for form/aria wiring).

## Components

### `ErrorBoundary({ fallback, onError?, children })`

Catches errors thrown while rendering its subtree and shows `fallback` (a node
or `(error) => node`) instead; `onError(error)` is called when it catches.

### `Suspense({ fallback, children })`

Shows `fallback` while a child throws a thenable, then re-renders when it
settles. There is no `lazy()` — the VM has no module loader.

### `components`

The record of trusted components the host registered, keyed by name —
destructure what you need, Figma-style:

```ts
const { View, Text } = zushi.components;
ui.render(h(View, null, h(Text, null, "hi")));
```

### `registerComponent(name, fn)`

Registers a trusted custom component into the `components` record. Sealed from
plugin code by default — only the trusted `setup` slot can call it. See
[Components & intrinsics](./components.md).
