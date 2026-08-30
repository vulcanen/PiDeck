import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: ".",
  plugins: [react()],
  base: "./",
  resolve: {
    // Keep shared icons and localized labels in sync with an already-open window.
    alias: {
      "@pideck/ui-system": fileURLToPath(new URL("../../packages/ui-system/src/index.tsx", import.meta.url)),
      "@pideck/i18n": fileURLToPath(new URL("../../packages/i18n/src/index.ts", import.meta.url)),
    },
  },
  optimizeDeps: {
    // The domain package is still rebuilt by predev.
    force: true,
    include: ["@pideck/domain"],
    exclude: ["@pideck/ui-system", "@pideck/i18n"],
  },
  build: {
    outDir: "../../dist-renderer",
    emptyOutDir: true,
    // Mermaid diagram engines are loaded on demand and the largest lazy chunk
    // is intentionally below this reviewed ceiling; it does not delay the
    // initial workspace render.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
