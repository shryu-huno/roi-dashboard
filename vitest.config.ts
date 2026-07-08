import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

function loadEnvTest(): Record<string, string> {
  const parsed = loadDotenv({ path: ".env.test" }).parsed ?? {};
  return parsed;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    env: loadEnvTest(),
  },
});
