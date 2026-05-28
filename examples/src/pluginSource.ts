// The UI rendered inside the sandboxed iframe. It posts "ready" on load,
// emits "inc" when the button is clicked, and echoes "rendered" back after the
// host updates the count — giving a full two-way round trip to assert on.
const html = `
  <style>
    body { font: 14px sans-serif; margin: 8px; }
    button { font: inherit; padding: 4px 10px; cursor: pointer; }
    output { display: inline-block; min-width: 2ch; font-weight: 600; }
  </style>
  <button id="btn">+1</button>
  <output id="out">0</output>
  <script>
    const out = document.getElementById("out");
    document.getElementById("btn").addEventListener("click", () => {
      parent.postMessage({ type: "inc" }, "*");
    });
    window.addEventListener("message", (e) => {
      if (e.data && e.data.type === "count") {
        out.textContent = String(e.data.value);
        parent.postMessage({ type: "rendered", value: e.data.value }, "*");
      }
    });
    parent.postMessage({ type: "ready" }, "*");
  </script>
`;

/**
 * Plugin code evaluated inside the QuickJS VM. Uses the built-in `ui` global
 * and a host-provided `host` API (see the example's `exposed`).
 */
export const pluginSource = `
  const html = ${JSON.stringify(html)};
  ui.show(html, { width: 220, height: 120 });

  let count = 0;
  ui.on("message", (msg) => {
    if (!msg) return;
    if (msg.type === "inc") {
      count = host.increment(count);
      ui.postMessage({ type: "count", value: count });
    } else if (msg.type === "ready") {
      host.event("ready");
    } else if (msg.type === "rendered") {
      host.event("rendered", msg.value);
    }
  });
`;

export type ExampleHost = {
  increment: (n: number) => number;
  event: (name: string, value?: number) => void;
};
