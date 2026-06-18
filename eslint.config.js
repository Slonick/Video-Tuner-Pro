// Flat ESLint config: TypeScript + React + React Hooks rules. Formatting is left
// to Prettier (eslint-config-prettier turns off any stylistic rules that overlap).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "coverage/",
      "node_modules/",
      "tools/",
      "e2e/",
      ".screenshots/",
      "**/*.mjs",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.webextensions },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "18" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      // TypeScript already reports undefined names (and knows DOM/WebExt types).
      "no-undef": "off",
      // Caught errors are routinely unused; ignore them and `_`-prefixed names.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Text is localized at runtime; raw apostrophes in the JSX defaults are fine.
      "react/no-unescaped-entities": "off",
      // Flag `any` (mostly in chrome mocks / Web Audio) without blocking the build.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Tests run under Node (jsdom env) and lean on loose mocks.
    files: ["test/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-this-alias": "off",
    },
  },
  prettier,
);
