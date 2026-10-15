import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { include: ["playwright-core"] },
      rolldownOptions: {
        input: {
          index: resolve(root, "src/main/app/index.ts"),
          "browser-worker": resolve(root, "src/main/workers/browser-worker.ts"),
          "extension-relay": resolve(root, "src/main/workers/extension-relay.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "chunks/[name]-[hash].cjs",
        },
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
