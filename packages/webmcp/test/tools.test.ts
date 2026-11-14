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
  it("registers status, list_scenarios, capture and load", () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    expect([...ctx.tools.keys()]).toEqual(["warpstate_status", "warpstate_list_scenarios", "warpstate_capture", "warpstate_load"]);
    expect(ctx.tools.get("warpstate_capture")!.annotations).toMatchObject({ readOnlyHint: true });
    expect(ctx.tools.get("warpstate_load")!.annotations).toMatchObject({ consequentialHint: true });
  });

  it("exposes tools to agents by default and can mark them developer-only", () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    for (const tool of ctx.tools.values()) expect(tool.annotations?.debugging).toBe(false);

    const devCtx = fakeModelContext();
    registerWarpTools({ modelContext: devCtx, debugging: true });
    for (const tool of devCtx.tools.values()) expect(tool.annotations?.debugging).toBe(true);
  });

  it("detects document.modelContext", () => {
    const ctx = fakeModelContext();
    (document as { modelContext?: unknown }).modelContext = ctx;
    registerWarpTools();
    expect(ctx.registerTool).toHaveBeenCalledTimes(4);
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
    expect(ctx.tools.size).toBe(3);
    controller.abort();
    expect(ctx.tools.size).toBe(0);
  });

  it("reports status", async () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_status");
    expect(out.structuredContent).toMatchObject({ status: "idle", bootedFromSnapshot: false, adapters: ["cart"] });
  });

  it("returns JSON for small snapshots in auto mode", async () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_capture", { name: "one mug" });
    expect(out.structuredContent.format).toBe("json");
  });

  it("switches to the compact form when it costs fewer tokens", async () => {
    registerAdapter({
      name: "catalog",
      capture: () => Array.from({ length: 300 }, (_, i) => ({ id: i, title: `Product ${i}`, inStock: true })),
      restore: () => {},
    });
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_capture");
    expect(out.structuredContent.format).toBe("compact");
    expect(Number(out.structuredContent.bytes)).toBeLessThan(Number(out.structuredContent.jsonBytes) / 4);
  });

  it("can force the compact form", async () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_capture", { name: "one mug", format: "compact" });
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

describe("scenario catalog", () => {
  const promo = { warpstate: 1, meta: { name: "promo" }, router: { entries: ["/promo"], index: 0 } };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  function mockCatalog() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/__warpstate/scenarios") return json(200, { scenarios: [{ id: "promo", name: "promo", route: "/promo" }] });
      if (url === "/__warpstate/scenarios/promo") return json(200, promo);
      return json(404, { error: `Unknown scenario "${decodeURIComponent(url.split("/").pop()!)}".`, available: ["promo"] });
    });
  }

  it("tells agents to list first and load by id", () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    expect(ctx.tools.get("warpstate_status")!.description).toMatch(/warpstate_list_scenarios.*warpstate_load/);
    expect(ctx.tools.get("warpstate_load")!.description).toMatch(/scenario/);
    expect(ctx.tools.get("warpstate_list_scenarios")!.annotations).toMatchObject({ readOnlyHint: true });
    // Several model APIs reject top-level oneOf/anyOf in tool input schemas.
    for (const tool of ctx.tools.values()) {
      expect(Object.keys(tool.inputSchema ?? {})).not.toEqual(expect.arrayContaining(["oneOf"]));
    }
  });

  it("lists the scenarios served by the dev server", async () => {
    mockCatalog();
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_list_scenarios");
    expect(out.structuredContent.scenarios).toEqual([{ id: "promo", name: "promo", route: "/promo" }]);
    expect(out.structuredContent.next).toMatch(/warpstate_load/);
  });

  it("explains how to enable the catalog when the server has none", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_list_scenarios");
    expect(out.isError).toBe(true);
    expect(String(out.structuredContent.error)).toMatch(/@warpstate\/vite/);
  });

  it("loads a scenario by id", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload: vi.fn() } as Location);
    mockCatalog();
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_load", { scenario: "promo" });
    expect(out.structuredContent).toEqual({ loading: "promo", reloading: true });
    expect(JSON.parse(sessionStorage.getItem(PENDING_STORAGE_KEY)!)).toEqual(promo);
  });

  it("lists the known ids when the scenario does not exist", async () => {
    const fetchMock = mockCatalog();
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_load", { scenario: "../secret" });
    expect(fetchMock).toHaveBeenCalledWith("/__warpstate/scenarios/..%2Fsecret", expect.anything());
    expect(out.isError).toBe(true);
    expect(String(out.structuredContent.error)).toBe('Unknown scenario "../secret". Known ids: promo.');
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull();
  });

  it("requires a scenario or a snapshot", async () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx });
    const out = await call(ctx, "warpstate_load", {});
    expect(out.isError).toBe(true);
    expect(String(out.structuredContent.error)).toMatch(/scenario.*snapshot/);
  });

  it("can be turned off", () => {
    const ctx = fakeModelContext();
    registerWarpTools({ modelContext: ctx, scenariosEndpoint: false });
    expect(ctx.tools.has("warpstate_list_scenarios")).toBe(false);
    expect(ctx.tools.get("warpstate_load")!.inputSchema).toMatchObject({ required: ["snapshot"] });
  });
});
