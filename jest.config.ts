import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: [
    "**/__tests__/**/*.+(ts|tsx|js)",
    "**/?(*.)+(spec|test).+(ts|tsx|js)",
  ],
  transform: {
    "^.+\\.[tj]sx?$": [
      "ts-jest",
      { tsconfig: "tsconfig.test.json", diagnostics: false },
    ],
  },
  // SDK v17 uses ESM dependencies even through its CommonJS entry point.
  transformIgnorePatterns: [
    "/node_modules/(?!\\.pnpm/|uint8array-extras/|@noble/|@exodus/|@stellar/js-xdr/)",
  ],
  collectCoverage: true,
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/__tests__/**",
    "!src/tests/**",
    "!src/cli/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "json-summary"],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 65,
      lines: 70,
      statements: 70,
    },
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@api/(.*)$": "<rootDir>/src/api/$1",
    "^@services/(.*)$": "<rootDir>/src/services/$1",
    "^@config/(.*)$": "<rootDir>/src/config/$1",
    "^@middleware/(.*)$": "<rootDir>/src/middleware/$1",
    "^@utils/(.*)$": "<rootDir>/src/utils/$1",
  },
};

export default config;
