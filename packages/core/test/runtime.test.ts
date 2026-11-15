import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureSnapshot,
  captureSnapshotWithReport,
  configureWarp,
  defineAdapter,
  getActiveSnapshot,
  getWarpGlobal,
  initWarp,
  isWarping,
  markWarpReady,
  registerAdapter,
  resetWarp,
  type WarpSnapshot,
} from "../src";

function inject(snapshot: unknown) {
  window.__WARPSTATE__ = { snapshot } as never;
}

const base: WarpSnapshot = { warpstate: 1, router: { entries: ["/a", "/b"], index: 1 } };

beforeEach(() => {
  resetWarp();
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("without a snapshot", () => {
  it("boots normally", () => {
    expect(initWarp()).toBeNull();
    expect(isWarping()).toBe(false);
    expect(getWarpGlobal()?.status).toBe("idle");
  });

  it("does not call restore", () => {
    const restore = vi.fn();
    registerAdapter({ name: "cart", capture: () => 1, restore });
    expect(restore).not.toHaveBeenCalled();
  });
});

describe("hydration", () => {
  it("restores adapters synchronously on registration", () => {
    inject({ ...base, stores: { cart: { items: 2 } } });
    initWarp();
    let state = { items: 0 };
    registerAdapter({ name: "cart", capture: () => state, restore: (data) => void (state = data) });
    expect(state).toEqual({ items: 2 });
    expect(getWarpGlobal()?.status).toBe("hydrating");
  });

  it("routes reserved names to top-level fields", () => {
    inject({ ...base, query: { queries: ["q"] } });
    initWarp();
    const query = vi.fn();
    const router = vi.fn();
    registerAdapter({ name: "query", capture: () => null, restore: query });
    registerAdapter({ name: "router", capture: () => null, restore: router });
    expect(query).toHaveBeenCalledWith({ queries: ["q"] });
    expect(router).toHaveBeenCalledWith(base.router);
  });

  it("restores each adapter name only once", () => {
    inject({ ...base, stores: { cart: 1 } });
    initWarp();
    const restore = vi.fn();
    registerAdapter({ name: "cart", capture: () => 0, restore });
    registerAdapter({ name: "cart", capture: () => 0, restore });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("waits for async restores before resolving ready", async () => {
    inject({ ...base, stores: { slow: 1 } });
    initWarp();
    let done = false;
    registerAdapter({
      name: "slow",
      capture: () => 0,
      restore: () => new Promise<void>((r) => setTimeout(() => ((done = true), r()), 10)),
    });
    const ready = getWarpGlobal()!.ready;
    await markWarpReady();
    await ready;
    expect(done).toBe(true);
    expect(getWarpGlobal()?.status).toBe("ready");
  });

  it("reports store data that no adapter claims", async () => {
    inject({ ...base, stores: { ghost: 1 } });
    initWarp();
    await markWarpReady();
    expect(getWarpGlobal()?.status).toBe("ready");
    expect(getWarpGlobal()?.warnings[0]).toMatch(/"ghost"/);
  });

  it("fails on unclaimed store data in strict mode", async () => {
    inject({ ...base, stores: { ghost: 1 } });
    initWarp({ strict: true });
    await markWarpReady();
    expect(getWarpGlobal()?.error?.code).toBe("UNKNOWN_STORE");
    await expect(getWarpGlobal()!.ready).rejects.toThrow(/ghost/);
  });

  it("surfaces adapter failures", () => {
    inject({ ...base, stores: { boom: 1 } });
    initWarp();
    registerAdapter({
      name: "boom",
      capture: () => 0,
      restore: () => {
        throw new Error("kaput");
      },
    });
    expect(getWarpGlobal()?.status).toBe("error");
    expect(getWarpGlobal()?.error).toEqual({
      code: "ADAPTER_FAILED",
      message: 'Adapter "boom" failed to restore: kaput',
    });
  });

  it("surfaces invalid snapshots and boots normally", async () => {
    inject({ warpstate: 1, router: { entries: [] } });
    expect(initWarp()).toBeNull();
    expect(getWarpGlobal()?.error?.code).toBe("INVALID_SNAPSHOT");
    await expect(getWarpGlobal()!.ready).rejects.toThrow(/router/);
  });

  it("restores storage unless the test runner already did", () => {
    inject({ ...base, storage: { local: { theme: "dark" }, session: { tab: "2" } } });
    initWarp();
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(sessionStorage.getItem("tab")).toBe("2");

    resetWarp();
    localStorage.clear();
    window.__WARPSTATE__ = { snapshot: { ...base, storage: { local: { theme: "dark" } } }, storageRestored: true } as never;
    initWarp();
    expect(localStorage.getItem("theme")).toBeNull();
  });
});

describe("production guard", () => {
  it("ignores snapshots in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    inject(base);
    expect(initWarp()).toBeNull();
    expect(getWarpGlobal()?.error?.code).toBe("PRODUCTION_BLOCKED");
  });

  it("allows explicit opt-in", () => {
    vi.stubEnv("NODE_ENV", "production");
    inject(base);
    expect(initWarp({ allowInProduction: true })).not.toBeNull();
  });

  it("cannot be opted into from the injected global", () => {
    vi.stubEnv("NODE_ENV", "production");
    window.__WARPSTATE__ = { snapshot: base, allowInProduction: true } as never;
    expect(initWarp()).toBeNull();
  });
});

describe("app identity and migration", () => {
  it("rejects obsolete snapshots", () => {
    inject({ ...base, app: { schemaVersion: "1" } });
    expect(initWarp({ app: { schemaVersion: "2" } })).toBeNull();
    expect(getWarpGlobal()?.error?.code).toBe("OBSOLETE_SNAPSHOT");
    expect(getWarpGlobal()?.error?.message).toMatch(/"1" but the app expects "2"/);
  });

  it("treats a missing schemaVersion as obsolete when the app declares one", () => {
    inject(base);
    expect(initWarp({ app: { schemaVersion: "2" } })).toBeNull();
  });

  it("migrates snapshots", () => {
    inject({ ...base, app: { schemaVersion: "1" }, stores: { cart: { count: 3 } } });
    const migrate = vi.fn((s: WarpSnapshot) => ({
      ...s,
      stores: { cart: { items: (s.stores?.cart as { count: number }).count } },
    }));
    const snapshot = initWarp({ app: { schemaVersion: "2" }, migrate });
    expect(migrate).toHaveBeenCalledWith(expect.anything(), { from: "1", to: "2" });
    expect(snapshot?.stores).toEqual({ cart: { items: 3 } });
    expect(snapshot?.app?.schemaVersion).toBe("2");
  });

  it("rejects when migrate gives up", () => {
    inject({ ...base, app: { schemaVersion: "1" } });
    expect(initWarp({ app: { schemaVersion: "2" }, migrate: () => null })).toBeNull();
    expect(getWarpGlobal()?.error?.code).toBe("OBSOLETE_SNAPSHOT");
  });

  it("validates migrated output", () => {
    inject({ ...base, app: { schemaVersion: "1" } });
    initWarp({ app: { schemaVersion: "2" }, migrate: (s) => ({ ...s, router: { entries: [], index: 0 } }) });
    expect(getWarpGlobal()?.error?.code).toBe("INVALID_SNAPSHOT");
  });

  it("rejects snapshots from another app", () => {
    inject({ ...base, app: { name: "admin" } });
    expect(initWarp({ app: { name: "shop" } })).toBeNull();
    expect(getWarpGlobal()?.error?.code).toBe("APP_MISMATCH");
  });
});

describe("capture", () => {
  it("collects router, query, stores and app identity", () => {
    configureWarp({ app: { name: "shop", schemaVersion: "3" } });
    registerAdapter({ name: "router", capture: () => ({ entries: ["/x"], index: 0 }), restore: () => {} });
    registerAdapter({ name: "query", capture: () => ({ queries: [] }), restore: () => {} });
    registerAdapter(defineAdapter({ name: "cart", capture: () => ({ items: [1] }), restore: () => {} }));
    const snapshot = captureSnapshot({ name: "Checkout" });
    expect(snapshot).toMatchObject({
      warpstate: 1,
      app: { name: "shop", schemaVersion: "3" },
      meta: { name: "Checkout" },
      router: { entries: ["/x"], index: 0 },
      query: { queries: [] },
      stores: { cart: { items: [1] } },
    });
    expect(snapshot.meta?.createdAt).toMatch(/^\d{4}-/);
    expect(snapshot.storage).toBeUndefined();
  });

  it("falls back to window.location without a router adapter", () => {
    window.history.replaceState(null, "", "/somewhere?x=1#top");
    expect(captureSnapshot().router).toEqual({ entries: ["/somewhere?x=1#top"], index: 0 });
  });

  it("captures storage only when opted in", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("token", "secret");
    localStorage.setItem("warpstate:internal", "x");
    expect(captureSnapshot().storage).toBeUndefined();
    configureWarp({ captureStorage: { local: ["theme"] } });
    expect(captureSnapshot().storage).toEqual({ local: { theme: "dark" } });
    configureWarp({ captureStorage: { local: true } });
    expect(captureSnapshot().storage).toEqual({ local: { theme: "dark", token: "secret" } });
  });

  it("reports non-serializable values", () => {
    registerAdapter({
      name: "weird",
      capture: () => ({ when: new Date(0), tags: new Set([1]), fn: () => 1, ok: "yes" }),
      restore: () => {},
    });
    const { warnings } = captureSnapshotWithReport();
    // Date and Set are encoded (encodeValue) and restore as themselves; functions cannot be.
    expect(warnings).toEqual(["stores.weird.fn: function (dropped)"]);
  });

  it("exposes capture on the global", () => {
    initWarp();
    expect(getWarpGlobal()?.capture?.().warpstate).toBe(1);
  });

  it("round-trips through the parser", () => {
    registerAdapter({ name: "cart", capture: () => ({ items: [1, 2] }), restore: () => {} });
    const captured = JSON.parse(JSON.stringify(captureSnapshot()));
    resetWarp();
    inject(captured);
    expect(getActiveSnapshot()?.stores).toEqual({ cart: { items: [1, 2] } });
  });
});
