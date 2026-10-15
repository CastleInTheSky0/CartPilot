import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: { index: resolve(root, "src/main/app/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: { index: resolve(root, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(root, "src/renderer"),
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
    build: {
      rolldownOptions: { input: resolve(root, "src/renderer/index.html") },
    },
  },
});
