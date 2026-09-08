import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: { PGLITE_DATA_DIR: ":memory:", ADMIN_PASSWORD: "test-admin", AUTH_SECRET: "test-secret" },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
