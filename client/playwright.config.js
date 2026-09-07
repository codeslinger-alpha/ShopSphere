import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    use: {
        baseURL: "http://127.0.0.1:5174",
        headless: true,
        actionTimeout: 15000,
        screenshot: "only-on-failure",
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    },
    webServer: {
        command: "npm run dev -- --host 127.0.0.1 --port 5174 --strictPort",
        // Probe TCP directly so a machine-wide HTTP proxy cannot stall startup.
        port: 5174,
        env: { VITE_API_URL: "/api" },
        reuseExistingServer: false
    }
});
