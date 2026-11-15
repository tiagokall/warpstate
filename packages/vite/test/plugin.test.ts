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
  const hook = plugin.resolveId as unknown as { filter: { id: RegExp }; handler: Hook };
  const resolveId = (source: string) => hook.handler.call(ctx, source, "/app/main.tsx", {});
  return { ctx, resolveId, filter: hook.filter.id };
}

describe("warpstate vite plugin", () => {
  it("only runs resolveId for the runtime packages (hook filter)", () => {
    const { filter } = setup({ command: "build", isProduction: true }, { extraPackages: ["@acme/warp-adapter.v2"] });
    for (const pkg of [...RUNTIME_PACKAGES, "@acme/warp-adapter.v2"]) expect(filter.test(pkg)).toBe(true);
    for (const other of ["react", "@warpstate/core/noop", "@warpstate/corex", "@acme/warp-adapterXv2"]) {
      expect(filter.test(other)).toBe(false);
    }
  });

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
    expect(await setup({ command: "serve", mode: "development", isProduction: false }).resolveId("@warpstate/core")).toBeNull();
    expect(await setup({ command: "build", mode: "staging", isProduction: false }).resolveId("@warpstate/core")).toBeNull();
  });

  it("strips when either the mode or NODE_ENV says production", async () => {
    const byMode = setup({ command: "build", mode: "production", isProduction: false });
    expect(await byMode.resolveId("@warpstate/core")).toEqual({ id: "/resolved/@warpstate/core/noop" });
    const byEnv = setup({ command: "build", mode: "staging", isProduction: true });
    expect(await byEnv.resolveId("@warpstate/core")).toEqual({ id: "/resolved/@warpstate/core/noop" });
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
