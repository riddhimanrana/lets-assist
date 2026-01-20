import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom", // Use jsdom as default for React compatibility
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "html"],
      reportsDirectory: "./coverage",
      include: [
        "utils/**/*.ts",
        "lib/**/*.ts",
        "services/**/*.ts",
        "hooks/**/*.ts",
        "app/**/actions.ts",
      ],
      exclude: [
        "**/*.d.ts",
        "**/*.test.ts",
        "**/node_modules/**",
        "utils/supabase/**", // Supabase client factories are thin wrappers
      ],
      thresholds: {
        // Start with minimal thresholds - increase as coverage improves
        // Current baseline: ~6% coverage
        lines: 5,
        functions: 5,
        branches: 4,
        statements: 5,
      },
    },
    // Test timeout
    testTimeout: 10000,
    // Pool configuration for isolation
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
