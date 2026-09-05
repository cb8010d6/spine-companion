import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "dist/**", "coverage/**", "src-tauri/**", ".runtime/**"] },
  {
    files: ["src/**/*.{js,cjs}", "scripts/*.{js,cjs,mjs}", "tests/*.mjs", "*.{js,mjs}"],
    ...js.configs.recommended,
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }] }
  },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs" } }
];
