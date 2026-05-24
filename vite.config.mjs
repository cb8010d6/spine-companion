import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        manager: resolve(__dirname, "manager.html"),
        panel: resolve(__dirname, "panel.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/pixi.js") || id.includes("node_modules/pixi-spine")) {
            return "pixi-spine-runtime";
          }
          if (id.includes("node_modules/@tauri-apps")) {
            return "tauri-api";
          }
        }
      }
    },
  },
  server: {
    host: "127.0.0.1",
    port: 17389,
    strictPort: false
  }
});
