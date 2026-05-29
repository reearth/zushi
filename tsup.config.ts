import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react/index.ts",
    jsx: "src/jsx/runtime.ts",
    "jsx-runtime": "src/jsx/jsx-runtime.ts",
    "jsx-dev-runtime": "src/jsx/jsx-dev-runtime.ts",
    "react-compat": "src/jsx/react-compat.ts"
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["react", "react-dom"]
});
