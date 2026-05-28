import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@reearth/niche/react": resolve(root, "src/react/index.ts"),
      "@reearth/niche": resolve(root, "src/index.ts")
    }
  },
  test: {
    globals: true,
    include: ["src/**/*.browser.test.ts", "examples/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }]
    }
  }
});
