import { type PluginContext, Plugin } from "@reearth/zushi";
import { PluginView } from "@reearth/zushi/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { jsxSetup, jsxPluginSource } from "./jsxPluginSource";
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

// React usage via <PluginView>.
function ReactExample() {
  const { log, host } = useHostLog();
  const hostRef = useRef(host);
  hostRef.current = host;

  const exposed = useCallback(
    ({ surfaces }: PluginContext) => ({
      ui: surfaces.ui.api,
      host: {
        increment: (n: number) => hostRef.current.increment(n),
        event: (name: string, value?: number) => hostRef.current.event(name, value)
      }
    }),
    []
  );

  return (
    <section className="card">
      <h2>React · &lt;PluginView&gt;</h2>
      <PluginView
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
      code: pluginSource,
      quickjs,
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

// Opt-in JSX runtime: the plugin builds UI declaratively with createElement +
// hooks, confined to host-registered components (intrinsics disabled).
function JsxExample() {
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

  return (
    <section className="card">
      <h2>JSX · render(&lt;App/&gt;)</h2>
      <PluginView
        jsx
        setup={jsxSetup}
        intrinsics={false}
        code={jsxPluginSource}
        quickjs={quickjs}
        autoResize="both"
        exposed={exposed}
        className="frame"
      />
      <Log entries={log} />
    </section>
  );
}

export function App() {
  return (
    <main>
      <h1>@reearth/zushi examples</h1>
      <p>
        Click <strong>+1</strong> inside each sandboxed iframe. The click is sent
        to the plugin VM, which calls the host API and posts the new count back
        into the iframe.
      </p>
      <div className="grid">
        <ReactExample />
        <VanillaExample />
        <JsxExample />
      </div>
    </main>
  );
}
