import type { ResolvedConfig } from "vite";
import { describe, expect, it, vi } from "vitest";
import { RUNTIME_PACKAGES, warpstate } from "../src";

type Hook = (this: unknown, ...args: unknown[]) => unknown;

function setup(config: Partial<ResolvedConfig>, options?: Parameters<typeof warpstate>[0]) {
  const plugin = warpstate(options);
  (plugin.configResolved as Hook).call({}, config);
  const ctx = {
    resolve: vi.fn(async (id: string) => ({ id: `/resolved/${id}` })),
    error: vi.fn((message: string) => {
      throw new Error(message);
    }),
  };
  const resolveId = (source: string) => (plugin.resolveId as Hook).call(ctx, source, "/app/main.tsx", {});
  return { ctx, resolveId };
}

describe("warpstate vite plugin", () => {
  it("swaps every runtime package for its noop entry in production builds", async () => {
    const { resolveId } = setup({ command: "build", isProduction: true });
    for (const pkg of RUNTIME_PACKAGES) {
      expect(await resolveId(pkg)).toEqual({ id: `/resolved/${pkg}/noop` });
    }
  });

  it("leaves other imports alone", async () => {
    const { resolveId } = setup({ command: "build", isProduction: true });
    expect(await resolveId("react")).toBeNull();
    expect(await resolveId("@warpstate/playwright")).toBeNull();
  });

  it("does nothing in dev or non-production builds", async () => {
    expect(await setup({ command: "serve", isProduction: false }).resolveId("@warpstate/core")).toBeNull();
    expect(await setup({ command: "build", isProduction: false }).resolveId("@warpstate/core")).toBeNull();
  });

  it("can keep the runtime in production", async () => {
    const { resolveId } = setup({ command: "build", isProduction: true }, { keepInProduction: true });
    expect(await resolveId("@warpstate/core")).toBeNull();
  });

  it("supports extra packages and fails loudly without a noop entry", async () => {
    const { ctx, resolveId } = setup({ command: "build", isProduction: true }, { extraPackages: ["my-adapter"] });
    expect(await resolveId("my-adapter")).toEqual({ id: "/resolved/my-adapter/noop" });
    ctx.resolve.mockResolvedValueOnce(null as never);
    await expect(resolveId("my-adapter")).rejects.toThrow(/has no "\/noop" entry/);
  });
});
