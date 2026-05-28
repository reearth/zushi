import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      "@reearth/zushi/react": resolve(root, "../src/react/index.ts"),
      "@reearth/zushi": resolve(root, "../src/index.ts")
    }
  }
});
