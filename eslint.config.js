import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "vendor/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "error",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { URL: "readonly", fetch: "readonly" } },
    rules: { "no-console": "off" },
  },
);
