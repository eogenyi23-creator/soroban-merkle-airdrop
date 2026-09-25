import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Point the workspace SDK package directly at its TypeScript source so
      // tests run without needing a prior `pnpm build` in the sdk/ package.
      "@soroban-merkle-airdrop/sdk": resolve(__dirname, "../sdk/src/index.ts"),
    },
  },
  test: {
    passWithNoTests: true,
  },
});
