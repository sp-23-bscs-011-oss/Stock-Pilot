import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

const testEnv = parse(readFileSync(new URL("./.env.test", import.meta.url)));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: testEnv,
    globalSetup: ["./tests/globalSetup.ts"],
    // Every file shares one test database, so run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
