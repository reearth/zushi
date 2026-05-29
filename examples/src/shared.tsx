import { quickjs } from "@reearth/zushi";
import { useCallback, useState } from "react";

import { type ExampleHost } from "./pluginSource";
import { quickjsModule } from "./quickjs";

// One backend factory, reused across the examples. The module is a singlefile
// QuickJS variant; each plugin still gets its own isolated context.
export const backend = quickjs({ module: quickjsModule });

/** A host API that logs every call, plus the running log to render. */
export function useHostLog() {
  const [log, setLog] = useState<string[]>([]);
  const append = useCallback((line: string) => setLog((l) => [...l, line]), []);
  const host: ExampleHost = {
    increment: (n) => {
      const next = n + 1;
      append(`host.increment(${n}) -> ${next}`);
      return next;
    },
    event: (name, value) =>
      append(`event: ${name}${value !== undefined ? ` (${value})` : ""}`)
  };
  return { log, host };
}

export function Log({ entries }: { entries: string[] }) {
  return (
    <pre className="log">
      {entries.length ? entries.join("\n") : "(no host calls yet)"}
    </pre>
  );
}
