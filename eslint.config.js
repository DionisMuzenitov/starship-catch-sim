import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/.vite/**",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  // Enforces ADR-004 (docs/adr/004-engine-agnostic-physics.md):
  // physics core must not depend on any rendering or UI library.
  {
    files: ["packages/physics/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "three", message: "ADR-004: physics core is engine-agnostic — no Three.js imports." },
            { name: "react", message: "ADR-004: physics core is engine-agnostic — no React imports." },
            { name: "react-dom", message: "ADR-004: physics core is engine-agnostic — no React DOM imports." },
          ],
          patterns: [
            { group: ["three/*"], message: "ADR-004: physics core is engine-agnostic — no Three.js imports." },
            { group: ["@react-three/*"], message: "ADR-004: physics core is engine-agnostic — no @react-three imports." },
          ],
        },
      ],
    },
  },
);
