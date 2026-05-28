import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      "@reearth/niche/react": resolve(root, "../src/react/index.ts"),
      "@reearth/niche": resolve(root, "../src/index.ts")
    }
  }
});
