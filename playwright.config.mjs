import { defineConfig, devices } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const port = Number(process.env.PLAYWRIGHT_PORT || 8768);
const httpUrl = `http://127.0.0.1:${port}/index.html`;
const fileUrl = pathToFileURL(path.resolve("index.html")).href;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  workers: 4,
  expect: {
    timeout: 5_000
  },
  fullyParallel: true,
  reporter: "list",
  webServer: {
    command: `python -m http.server ${port} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${port}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  },
  projects: [
    {
      name: "chromium-http",
      use: { ...devices["Desktop Chrome"], browserName: "chromium", baseURL: httpUrl }
    },
    {
      name: "firefox-http",
      use: { ...devices["Desktop Firefox"], browserName: "firefox", baseURL: httpUrl }
    },
    {
      name: "chromium-file",
      use: { ...devices["Desktop Chrome"], browserName: "chromium", baseURL: fileUrl }
    },
    {
      name: "firefox-file",
      use: { ...devices["Desktop Firefox"], browserName: "firefox", baseURL: fileUrl }
    }
  ]
});
