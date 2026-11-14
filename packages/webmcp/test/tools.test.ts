import {
  PENDING_STORAGE_KEY,
  decodeSnapshot,
  registerAdapter,
  resetWarp,
} from "@warpstate/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWarpTools, type WebMcpTool } from "../src";

function fakeModelContext() {
  const tools = new Map<string, WebMcpTool>();
  return {
    tools,
    registerTool: vi.fn((tool: WebMcpTool, options?: { signal?: AbortSignal }) => {
      tools.set(tool.name, tool);
      return new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          tools.delete(tool.name);
          reject(options.signal!.reason);
        });
      });
    }),
  };
}

async function call(ctx: ReturnType<typeof fakeModelContext>, name: string, input: Record<string, unknown> = {}) {
  const out = (await ctx.tools.get(name)!.execute(input)) as { structuredContent: Record<string, unknown>; content: Array<{ text: string }>; isError?: boolean };
  expect(JSON.parse(out.content[0]!.text)).toEqual(out.structuredContent);
  return out;
}

beforeEach(() => {
  resetWarp();
  sessionStorage.clear();
  registerAdapter({ name: "cart", capture: () => ({ items: ["mug"] }), restore: () => {} });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (document as { modelContext?: unknown }).modelContext;
});

describe("registerWarpTools", () => {
  it("registers status, capture and load", () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    expect([...ctx.tools.keys()]).toEqual(["warpstate_status", "warpstate_capture", "warpstate_load"]);
    expect(ctx.tools.get("warpstate_capture")!.annotations).toMatchObject({ readOnlyHint: true });
    expect(ctx.tools.get("warpstate_load")!.annotations).toMatchObject({ consequentialHint: true });
  });

  it("detects document.modelContext", () => {
    const ctx = fakeModelContext();
    (document as { modelContext?: unknown }).modelContext = ctx;
    registerWarpTools();
    expect(ctx.registerTool).toHaveBeenCalledTimes(3);
  });

  it("is a no-op without WebMCP support", () => {
    expect(() => registerWarpTools()()).not.toThrow();
  });

  it("unregisters through the returned function or a signal", () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx })();
    expect(ctx.tools.size).toBe(0);

    const controller = new AbortController();
    registerWarpTools({ modelContext: ctx, signal: controller.signal, allowLoad: false });
    expect(ctx.tools.size).toBe(2);
    controller.abort();
    expect(ctx.tools.size).toBe(0);
  });

  it("reports status", async () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_status");
    expect(out.structuredContent).toMatchObject({ status: "idle", bootedFromSnapshot: false, adapters: ["cart"] });
  });

  it("captures compact snapshots by default", async () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_capture", { name: "one mug" });
    expect(out.structuredContent.format).toBe("compact");
    const snapshot = await decodeSnapshot(out.structuredContent.snapshot);
    expect(snapshot.meta?.name).toBe("one mug");
    expect(snapshot.stores).toEqual({ cart: { items: ["mug"] } });

    const json = await call(ctx, "warpstate_capture", { format: "json" });
    expect((json.structuredContent.snapshot as { stores: unknown }).stores).toEqual({ cart: { items: ["mug"] } });
  });

  it("loads a snapshot by queueing it and reloading", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const snapshot = { warpstate: 1, meta: { name: "promo" }, router: { entries: ["/promo"], index: 0 } };
    const out = await call(ctx, "warpstate_load", { snapshot });
    expect(out.structuredContent).toEqual({ loading: "promo", reloading: true });
    expect(JSON.parse(sessionStorage.getItem(PENDING_STORAGE_KEY)!)).toEqual(snapshot);
    vi.runAllTimers();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("returns tool errors for invalid snapshots", async () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_load", { snapshot: "warp1.garbage" });
    expect(out.isError).toBe(true);
    expect(String(out.structuredContent.error)).toMatch(/not a valid compact/);
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull();
  });
});
