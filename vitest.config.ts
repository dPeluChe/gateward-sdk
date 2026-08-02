import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // Node by default; the React binding tests opt into jsdom per file
    // (`@vitest-environment jsdom`) so the rest of the suite stays fast.
    environment: "node",
  },
});
