import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
