import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import-x";

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      "**/dist",
      "**/node_modules",
      "**/build",
      "**/target",
      "contracts/**",
      "scripts/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      prettier,
      "import-x": importPlugin,
    },
    rules: {
      // Prettier
      "prettier/prettier": "error",

      // Import order: builtin → external → internal → relative
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", ["parent", "sibling", "index"]],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      // TypeScript
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "off",

      // General
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  prettierConfig,
];

// Strict no-console rule for src/ (except logger utility)
const srcConfig = {
  files: ["src/**/*.ts", "src/**/*.tsx"],
  rules: {
    "no-console": "error",
  },
};

// Exempt logger utility and CLI from no-console rule
const loggerExemption = {
  files: ["src/utils/logger.ts", "src/cli/index.ts"],
  rules: {
    "no-console": "off",
  },
};

export default [...config, srcConfig, loggerExemption];
