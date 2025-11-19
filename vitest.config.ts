import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: `${resolve(__dirname, "./")}/`,
      },
    ],
  },
  test: {
    environment: "jsdom",
  },
});
