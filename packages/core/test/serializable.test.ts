import { afterEach, describe, expect, it } from "vitest";
import {
  captureSnapshot,
  decodeValue,
  encodeValue,
  getWarpGlobal,
  registerAdapter,
  resetWarp,
} from "../src";

afterEach(() => {
  resetWarp();
  delete (window as { __WARPSTATE__?: unknown }).__WARPSTATE__;
});

describe("encodeValue / decodeValue", () => {
  it("round-trips Map, Set, Date and bigint through JSON, nested anywhere", () => {
    const value = {
      sensors: new Map<string, unknown>([
        ["room-1", [{ id: "s1", seen: new Date("2026-11-14T10:00:00Z") }]],
        ["room-2", new Set(["a", "b"])],
      ]),
      ids: new Set([1, 2]),
      big: 12345678901234567890n,
      plain: { list: [1, "x", null], nested: { ok: true } },
      invalidDate: new Date(Number.NaN),
    };
    const restored = decodeValue(JSON.parse(JSON.stringify(encodeValue(value)))) as typeof value;
    expect(restored.sensors).toBeInstanceOf(Map);
    expect([...restored.sensors.keys()]).toEqual(["room-1", "room-2"]);
    const [first] = restored.sensors.get("room-1") as Array<{ seen: Date }>;
    expect(first!.seen).toBeInstanceOf(Date);
    expect(first!.seen.toISOString()).toBe("2026-11-14T10:00:00.000Z");
    expect(restored.sensors.get("room-2")).toEqual(new Set(["a", "b"]));
    expect(restored.ids).toEqual(new Set([1, 2]));
    expect(restored.big).toBe(12345678901234567890n);
    expect(restored.plain).toEqual(value.plain);
    expect(Number.isNaN(restored.invalidDate.getTime())).toBe(true);
  });

  it("leaves plain JSON untouched", () => {
    const plain = { a: [1, { b: "c" }], d: null };
    expect(encodeValue(plain)).toEqual(plain);
    expect(decodeValue(plain)).toEqual(plain);
  });
});

describe("capture and restore", () => {
  it("adapters get their Maps back instead of {} (the 'is not iterable' crash)", () => {
    const sensors = new Map([["room-1", ["s1"]]]);
    registerAdapter({ name: "sensors", capture: () => sensors, restore: () => {} });
    const snapshot = JSON.parse(JSON.stringify(captureSnapshot()));
    expect(snapshot.stores.sensors).toEqual({ $warp: "Map", entries: [["room-1", ["s1"]]] });

    resetWarp();
    getWarpGlobal()!.snapshot = snapshot;
    let restored: unknown;
    registerAdapter({ name: "sensors", capture: () => undefined, restore: (data) => void (restored = data) });
    expect(restored).toEqual(sensors);
    expect(restored).toBeInstanceOf(Map);
  });
});
