import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { describe, expect, it } from "vitest";
import { warpstate } from "../src";

const root = fileURLToPath(new URL("./fixture", import.meta.url));

async function bundle(plugins: ReturnType<typeof warpstate>[]): Promise<string> {
  const output = (await build({
    configFile: false,
    root,
    logLevel: "silent",
    mode: "production",
    plugins,
    build: {
      write: false,
      minify: false,
      lib: { entry: "main.js", formats: ["es"], fileName: "main" },
    },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  const outputs = Array.isArray(output) ? output : [output];
  return outputs
    .flatMap((o) => o.output)
    .map((chunk) => ("code" in chunk ? chunk.code : ""))
    .join("\n");
}

describe("real vite build", () => {
  it("bundles the real runtime without the plugin", async () => {
    const code = await bundle([]);
    expect(code).toContain("OBSOLETE_SNAPSHOT");
  }, 60_000);

  it("ships only the no-op runtime with the plugin", async () => {
    const code = await bundle([warpstate()]);
    expect(code).not.toContain("OBSOLETE_SNAPSHOT");
    expect(code).not.toMatch(/zod/i);
    expect(code).toContain("is not available in production builds");
  }, 60_000);
});
