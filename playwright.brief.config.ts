import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/brief-e2e",
  workers: 1,
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:4311", headless: true },
  webServer: {
    command: "npm run start -- --port 4311",
    url: "http://127.0.0.1:4311",
    reuseExistingServer: false,
  },
  reporter: "list",
  timeout: 30000,
});
