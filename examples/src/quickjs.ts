import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten";

// A singlefile variant embeds the wasm as base64, so no separate `.wasm` fetch
// is needed — ideal for bundlers/browsers (Vite, etc.). One module instance is
// shared across all plugins; each plugin gets its own VM context.
export const quickjs = newQuickJSWASMModuleFromVariant(variant);
