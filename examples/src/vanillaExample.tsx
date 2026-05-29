import { Plugin } from "@reearth/zushi";
import { useEffect, useRef } from "react";

import { pluginSource } from "./pluginSource";
import { backend, Log, useHostLog } from "./shared";

// Framework-agnostic usage via the core `Plugin` class.
export function VanillaExample() {
  const { log, host } = useHostLog();
  const hostRef = useRef(host);
  hostRef.current = host;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const plugin = new Plugin({
      code: pluginSource,
      backend,
      surfaces: { ui: { container, autoResize: "both" } },
      exposed: ({ surfaces }) => ({
        ui: surfaces.ui.api,
        host: {
          increment: (n: number) => hostRef.current.increment(n),
          event: (name: string, value?: number) => hostRef.current.event(name, value)
        }
      })
    });
    plugin.start();
    return () => plugin.dispose();
  }, []);

  return (
    <section className="card">
      <h2>Vanilla · new Plugin()</h2>
      <div ref={containerRef} className="frame" />
      <Log entries={log} />
    </section>
  );
}
