import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:5174",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node --import tsx tests/browserServer.ts",
      cwd: fileURLToPath(new URL("../backend", import.meta.url)),
      url: "http://127.0.0.1:4001/api/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5174",
      url: "http://localhost:5174",
      env: { VITE_DEV_API_PROXY_TARGET: "http://127.0.0.1:4001" },
      reuseExistingServer: false,
    },
  ],
});
