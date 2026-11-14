import { describe, expect, it } from "vitest";
import { matchesShortcut, parseShortcut, serializeSnapshot, snapshotFileName } from "../src";

const snap = (entries: string[], name?: string) => ({
  warpstate: 1 as const,
  router: { entries, index: entries.length - 1 },
  ...(name ? { meta: { name } } : {}),
});

describe("snapshotFileName", () => {
  it("prefers meta.name", () => {
    expect(snapshotFileName(snap(["/"], "Checkout with Coupón!"))).toBe("checkout-with-coupon.warp.json");
  });
  it("falls back to the current route", () => {
    expect(snapshotFileName(snap(["/", "/products/42?tab=reviews"]))).toBe("products-42.warp.json");
    expect(snapshotFileName(snap(["/"]))).toBe("root.warp.json");
  });
});

describe("serializeSnapshot", () => {
  it("is pretty printed with a trailing newline", () => {
    expect(serializeSnapshot(snap(["/"]))).toMatch(/^\{\n {2}"warpstate": 1,[\s\S]*\}\n$/);
  });
});

describe("shortcuts", () => {
  const event = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("matches ctrl+shift+s using key or code", () => {
    expect(matchesShortcut(event({ key: "S", ctrlKey: true, shiftKey: true }), "ctrl+shift+s")).toBe(true);
    expect(matchesShortcut(event({ key: "Ś", code: "KeyS", ctrlKey: true, shiftKey: true }), "ctrl+shift+s")).toBe(true);
  });

  it("requires the exact modifiers", () => {
    expect(matchesShortcut(event({ key: "s", ctrlKey: true }), "ctrl+shift+s")).toBe(false);
    expect(matchesShortcut(event({ key: "s", ctrlKey: true, shiftKey: true, altKey: true }), "ctrl+shift+s")).toBe(false);
  });

  it("rejects shortcuts without a key", () => {
    expect(() => parseShortcut("ctrl+shift")).toThrow(/missing a key/);
  });
});
