import { type PluginContext, Plugin } from "@reearth/niche";
import { NichePlugin } from "@reearth/niche/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { type ExampleHost, pluginSource } from "./pluginSource";
import { quickjs } from "./quickjs";

function useHostLog() {
  const [log, setLog] = useState<string[]>([]);
  const append = useCallback(
    (line: string) => setLog((l) => [...l, line]),
    []
  );
  const host: ExampleHost = {
    increment: (n) => {
      const next = n + 1;
      append(`host.increment(${n}) -> ${next}`);
      return next;
    },
    event: (name, value) => append(`event: ${name}${value !== undefined ? ` (${value})` : ""}`)
  };
  return { log, host };
}

function Log({ entries }: { entries: string[] }) {
  return (
    <pre className="log">
      {entries.length ? entries.join("\n") : "(no host calls yet)"}
    </pre>
  );
}

// React usage via <NichePlugin>.
function ReactExample() {
  const { log, host } = useHostLog();
  const hostRef = useRef(host);
  hostRef.current = host;

  const exposed = useCallback(
    (_ctx: PluginContext) => ({
      host: {
        increment: (n: number) => hostRef.current.increment(n),
        event: (name: string, value?: number) => hostRef.current.event(name, value)
      }
    }),
    []
  );

  return (
    <section className="card">
      <h2>React · &lt;NichePlugin&gt;</h2>
      <NichePlugin
        code={pluginSource}
        quickjs={quickjs}
        autoResize="both"
        exposed={exposed}
        className="frame"
      />
      <Log entries={log} />
    </section>
  );
}

// Framework-agnostic usage via the core `Plugin` class.
function VanillaExample() {
  const { log, host } = useHostLog();
  const hostRef = useRef(host);
  hostRef.current = host;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const plugin = new Plugin({
      container,
      code: pluginSource,
      quickjs,
      autoResize: "both",
      exposed: () => ({
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

export function App() {
  return (
    <main>
      <h1>@reearth/niche examples</h1>
      <p>
        Click <strong>+1</strong> inside each sandboxed iframe. The click is sent
        to the plugin VM, which calls the host API and posts the new count back
        into the iframe.
      </p>
      <div className="grid">
        <ReactExample />
        <VanillaExample />
      </div>
    </main>
  );
}
