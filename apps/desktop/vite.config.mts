import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  plugins: [react()],
  base: "./",
  optimizeDeps: {
    // Workspace packages are rebuilt by predev. Always invalidate Vite's
    // dependency cache so newly added i18n keys are not served from an older
    // prebundle (which otherwise renders labels as empty strings).
    force: true,
    include: ["@pideck/domain", "@pideck/i18n", "@pideck/ui-system"],
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
