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
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      { tsconfig: "tsconfig.test.json", diagnostics: false },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!(uuid)/)"],
  collectCoverage: true,
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/__tests__/**",
    "!src/tests/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 65,
      lines: 70,
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
