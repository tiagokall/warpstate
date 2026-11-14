import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENCODED_PREFIX,
  PENDING_STORAGE_KEY,
  createInitScript,
  decodeSnapshot,
  encodeSnapshot,
  getWarpGlobal,
  initWarp,
  loadSnapshot,
  resetWarp,
  serializeSnapshot,
  type WarpSnapshot,
} from "../src";

const snapshot: WarpSnapshot = {
  warpstate: 1,
  meta: { name: "big cart" },
  router: { entries: ["/", "/cart"], index: 1 },
  stores: {
    cart: {
      items: Array.from({ length: 200 }, (_, i) => ({ id: i, title: `Product ${i}`, price: 10 + i, qty: 1 })),
    },
  },
};

beforeEach(() => {
  resetWarp();
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("compact encoding", () => {
  it("round-trips", async () => {
    const encoded = await encodeSnapshot(snapshot);
    expect(encoded.startsWith(ENCODED_PREFIX)).toBe(true);
    expect(encoded).toMatch(/^warp1\.[A-Za-z0-9_-]+$/);
    expect(await decodeSnapshot(encoded)).toEqual(snapshot);
  });

  it("is much smaller than the pretty JSON file", async () => {
    const encoded = await encodeSnapshot(snapshot);
    expect(encoded.length).toBeLessThan(serializeSnapshot(snapshot).length * 0.2);
  });

  it("decodes plain JSON and objects too", async () => {
    expect(await decodeSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(await decodeSnapshot(snapshot)).toEqual(snapshot);
  });

  it("explains corrupt compact strings", async () => {
    await expect(decodeSnapshot("warp1.not-really", { source: "clipboard" })).rejects.toThrow(
      /\(clipboard\) is not a valid compact warpstate string/,
    );
  });
});

describe("createInitScript", () => {
  it("prepares the global and storage before the app runs", async () => {
    const script = createInitScript({
      ...snapshot,
      storage: { local: { theme: "dark" }, session: { tab: "2" } },
    });
    new Function(script)();
    const global = window.__WARPSTATE__!;
    expect(global.status).toBe("pending");
    expect(global.storageRestored).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(sessionStorage.getItem("tab")).toBe("2");

    // The app side takes over the same global and promise.
    const ready = global.ready;
    expect(initWarp()?.meta?.name).toBe("big cart");
    expect(getWarpGlobal()?.ready).toBe(ready);
    expect(getWarpGlobal()?.status).toBe("hydrating");
  });

  it("survives hostile strings", () => {
    const tricky = { ...snapshot, meta: { name: "</script><script>alert(1)</script>  " } };
    const script = createInitScript(tricky);
    expect(script).not.toContain("</script>");
    new Function(script)();
    expect((window.__WARPSTATE__!.snapshot as WarpSnapshot).meta?.name).toBe(tricky.meta.name);
  });

  it("drops a stale pending snapshot so the injected one wins", () => {
    sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ ...snapshot, meta: { name: "stale" } }));
    new Function(createInitScript(snapshot))();
    expect(initWarp()?.meta?.name).toBe("big cart");
  });
});

describe("loadSnapshot", () => {
  it("queues the snapshot for the next boot", async () => {
    const encoded = await encodeSnapshot(snapshot);
    await loadSnapshot(encoded, { reload: false });
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).not.toBeNull();

    // Simulate the reload.
    resetWarp();
    expect(initWarp()?.meta?.name).toBe("big cart");
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull(); // consumed once
  });

  it("rejects invalid input without queueing anything", async () => {
    await expect(loadSnapshot({ nope: true }, { reload: false })).rejects.toThrow(/Invalid warpstate snapshot/);
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull();
  });

  it("is exposed on the global", () => {
    initWarp();
    expect(typeof getWarpGlobal()?.load).toBe("function");
  });
});
