import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: { PIPELINE_NOW: "2026-09-01T03:00:00+02:00" },
  },
});
