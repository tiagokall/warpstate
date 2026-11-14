import { describe, expect, it } from "vitest";
import { WarpError, parseSnapshot, safeParseSnapshot } from "../src";

const valid = { warpstate: 1, router: { entries: ["/", "/cart"], index: 1 } };

describe("parseSnapshot", () => {
  it("accepts a minimal snapshot", () => {
    expect(parseSnapshot(valid)).toEqual(valid);
  });

  it("accepts JSON strings", () => {
    expect(parseSnapshot(JSON.stringify(valid)).router.index).toBe(1);
  });

  it("keeps every optional section", () => {
    const full = {
      ...valid,
      app: { name: "shop", schemaVersion: "2" },
      meta: { name: "cart", description: "two items", createdAt: "2026-01-01T00:00:00.000Z" },
      stores: { cart: { items: [1, 2] } },
      query: { queries: [], mutations: [] },
      storage: { local: { theme: "dark" }, session: { tab: "a" } },
    };
    expect(parseSnapshot(full)).toEqual(full);
  });

  it("lists every problem with its path", () => {
    const result = safeParseSnapshot({ warpstate: 1, router: { entries: [], index: -1 }, storage: { local: { a: 1 } } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeInstanceOf(WarpError);
    expect(result.error.code).toBe("INVALID_SNAPSHOT");
    expect(result.error.message).toContain("router.entries");
    expect(result.error.message).toContain("router.index");
    expect(result.error.message).toContain("storage.local.a");
  });

  it("rejects an index past the end of the history", () => {
    expect(() => parseSnapshot({ warpstate: 1, router: { entries: ["/"], index: 1 } })).toThrow(
      /router.index must point to an existing entry/,
    );
  });

  it("explains unsupported format versions", () => {
    const result = safeParseSnapshot({ warpstate: 2, router: { entries: ["/"], index: 0 } });
    expect(!result.success && result.error.code).toBe("UNSUPPORTED_FORMAT");
    expect(!result.success && result.error.message).toMatch(/Upgrade the @warpstate/);
  });

  it("mentions the source in errors", () => {
    expect(() => parseSnapshot("{oops", { source: "e2e/snapshots/a.warp.json" })).toThrow(
      /a\.warp\.json\) is not valid JSON/,
    );
  });
});
