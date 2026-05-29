import { type PluginContext } from "@reearth/zushi";
import { usePlugin } from "@reearth/zushi/react";
import { useCallback, useRef } from "react";

import { backend, Log, useHostLog } from "./shared";

// The plugin's counter lives in the host-owned synced store, keyed "count".
const syncedPluginSource = `
  const { useSyncedState, h, render } = zushi;
  function App() {
    const [n, setN] = useSyncedState("count", 0);
    return h("div", { style: { font: "14px sans-serif", padding: "8px", display: "flex", gap: "8px", alignItems: "center" } },
      h("button", { onClick: () => setN(n + 1) }, "plugin +1"),
      h("strong", null, "count: " + n)
    );
  }
  render(h(App));
`;

// Synced state: the count is shared two-way with the host and persisted across
// reloads. The plugin bumps it from inside; the host bumps it via plugin.synced.
export function SyncedExample() {
  const { log, host } = useHostLog();
  const hostRef = useRef(host);
  hostRef.current = host;

  const exposed = useCallback(
    (_ctx: PluginContext) => ({
      host: {
        event: (name: string, value?: number) =>
          hostRef.current.event(name, value)
      }
    }),
    []
  );

  const { containerRef, getPlugin } = usePlugin({
    backend,
    jsx: true,
    synced: { persist: true, instanceId: "synced-demo" }, // survives reload
    autoResize: "both",
    code: syncedPluginSource,
    exposed
  });

  const bumpFromHost = () => {
    const synced = getPlugin()?.synced;
    if (!synced) return;
    const next = ((synced.get("count") as number) ?? 0) + 1;
    synced.set("count", next); // → the plugin re-renders with the new value
    hostRef.current.event("host set count", next);
  };

  return (
    <section className="card">
      <h2>Synced · useSyncedState</h2>
      <div ref={containerRef} className="frame" />
      <button onClick={bumpFromHost}>host +1</button>
      <p style={{ fontSize: 12, opacity: 0.7, margin: "6px 0 0" }}>
        Shared two-way with the host, and persisted — reload and the count stays.
      </p>
      <Log entries={log} />
    </section>
  );
}
