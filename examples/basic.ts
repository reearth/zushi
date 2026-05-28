import { Plugin } from "@reearth/niche";

// A minimal example: run a plugin that renders UI, exchanges messages with its
// iframe, and calls a host-provided API. Bundle this with any bundler (Vite,
// esbuild, etc.) and open it in a browser.

const container = document.getElementById("plugin-ui");
if (!container) throw new Error("missing #plugin-ui element");

const pluginSource = `
  // Runs inside the QuickJS VM — no DOM, no network, no host globals.
  reearth.ui.show(\`
    <button id="btn">click me</button>
    <script>
      document.getElementById("btn").addEventListener("click", () => {
        parent.postMessage({ type: "clicked", at: Date.now() }, "*");
      });
    <\\/script>
  \`, { width: 200, height: 80 });

  reearth.ui.on("message", (msg) => {
    reearth.console.log("plugin received from iframe:", msg);
    host.notify("button was clicked");
  });
`;

const plugin = new Plugin({
  container,
  code: pluginSource,
  autoResize: "both",
  exposed: ({ ui }) => ({
    reearth: { ui: ui.uiAPI },
    host: {
      notify: (text: string) => {
        console.log("[host]", text);
      }
    }
  }),
  onError: (err) => console.error("plugin error:", err)
});

await plugin.start();

// Clean up when you're done:
// plugin.dispose();
