import { describe, expect, it } from "vitest";
import * as noop from "../src/noop";
import * as real from "../src";

describe("noop build", () => {
  it("exports exactly the same runtime names as the real module", () => {
    expect(Object.keys(noop).sort()).toEqual(Object.keys(real).sort());
  });

  it("never hydrates", () => {
    expect(noop.initWarp()).toBeNull();
    expect(noop.isWarping()).toBe(false);
  });
});
