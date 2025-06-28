import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import jestPlugin from "eslint-plugin-jest"
import { plugin } from "mongoose";

export default defineConfig([
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts}" , ],  plugins: { js }, extends: ["js/recommended"] },
  {
    files: ["__test__/**/*.{js,ts,mjs,mts}"],
    plugins: {jest : jestPlugin},
    languageOptions: {
      globals: jestPlugin.environments.globals.globals,
    },
    rules: {
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
      'jest/no-identical-title': 'error',
      'jest/prefer-to-have-length': 'warn',
      'jest/valid-expect': 'error',
    },
  },
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts}"], languageOptions: { globals: globals.node } },
  tseslint.configs.recommended,
]);
