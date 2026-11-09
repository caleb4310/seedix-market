import { defineConfig } from "@playwright/test";

const port = 3011;

export default defineConfig({
  testDir: "./e2e-fork",
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
