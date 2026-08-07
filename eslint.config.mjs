import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Baseline only: catches real bugs (unused vars, fallthrough, unreachable
// code) without rewriting existing style. Tighten rules incrementally;
// do not mix rule changes with behavior changes in the same commit.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-renderer/**",
      "**/release/**",
      "**/node_modules/**",
      "**/__pycache__/**",
      ".playwright-cli/**",
      ".pi/**",
      ".claude/**",
      ".codex/**",
      ".workbuddy/**",
      "_repair_tmp/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/desktop/src/renderer/**/*"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // CommonJS entry points legitimately use require().
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: [
      "packages/**/*",
      "apps/desktop/src/main/**/*",
      "apps/desktop/src/preload/**/*",
      "apps/desktop/scripts/**/*",
      "apps/desktop/vite.config.ts",
      "*.mjs",
      "*.cjs",
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      // The Pi SDK surface is intentionally loosely typed in pi-adapter;
      // re-enable per-package once structural Pi types exist.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Many empty catch blocks are deliberate degradation paths.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
