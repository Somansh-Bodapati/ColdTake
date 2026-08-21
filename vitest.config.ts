import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts: the React Router Vite plugin expects a full
// app build graph (routes, entry points) that a unit-test run doesn't have.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: true,
    // No test files exist yet at Session 0 scaffolding — Session 1 adds the
    // scoring engine tests (written before the resolvers, per CLAUDE.md).
    passWithNoTests: true,
  },
});
