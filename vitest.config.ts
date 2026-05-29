import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["src/**/*.browser.test.ts", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.browser.test.ts",
        // Shipped as source strings / shims that execute inside the QuickJS VM
        // or the sandboxed iframe — not in Node, so V8 coverage can't observe
        // them even though tests exercise them (in the VM / a real browser).
        "src/jsx/vmRuntime.ts",
        "src/jsx/patcher.ts",
        "src/jsx/runtime.ts",
        "src/jsx/react-compat.ts",
        "src/jsx/jsx-runtime.ts",
        "src/jsx/jsx-dev-runtime.ts",
        // React adapter — exercised by the browser tests, not the Node suite.
        "src/react/**",
        // Type-only modules (no runtime to cover).
        "src/**/types.ts"
      ]
    }
  }
});
