import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "es2022",
  },
  {
    // CLI: ESM only (its image-diff dependency is ESM-only).
    entry: { shots: "src/shots.ts" },
    format: ["esm"],
    sourcemap: true,
    target: "es2022",
  },
]);
