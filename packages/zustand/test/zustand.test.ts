import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { create } from "zustand";
import { zustandAdapter } from "../src";

interface Cart {
  items: string[];
  coupon: string | null;
  add: (item: string) => void;
}

const makeCart = () =>
  createStore<Cart>()((set) => ({
    items: [],
    coupon: null,
    add: (item) => set((s) => ({ items: [...s.items, item] })),
  }));

describe("zustandAdapter", () => {
  it("captures data but not actions", () => {
    const store = makeCart();
    store.getState().add("mug");
    expect(zustandAdapter("cart", store).capture()).toEqual({ items: ["mug"], coupon: null });
  });

  it("restores data and keeps actions working", () => {
    const store = makeCart();
    zustandAdapter("cart", store).restore({ items: ["mug", "tee"], coupon: "TEN" });
    expect(store.getState().items).toEqual(["mug", "tee"]);
    expect(store.getState().coupon).toBe("TEN");
    store.getState().add("cap");
    expect(store.getState().items).toEqual(["mug", "tee", "cap"]);
  });

  it("supports partialize and merge", () => {
    const store = makeCart();
    const adapter = zustandAdapter("cart", store, {
      partialize: (s) => ({ count: s.items.length }),
      merge: (captured) => ({ items: Array.from({ length: captured.count }, (_, i) => `item-${i}`) }),
    });
    store.getState().add("a");
    store.getState().add("b");
    const captured = adapter.capture();
    expect(captured).toEqual({ count: 2 });
    const other = makeCart();
    zustandAdapter("cart", other, {
      partialize: (s) => ({ count: s.items.length }),
      merge: (c) => ({ items: Array.from({ length: c.count }, (_, i) => `item-${i}`) }),
    }).restore(captured);
    expect(other.getState().items).toEqual(["item-0", "item-1"]);
  });

  it("accepts the create() hook", () => {
    const useCart = create<Cart>()((set) => ({
      items: ["x"],
      coupon: null,
      add: (item) => set((s) => ({ items: [...s.items, item] })),
    }));
    expect(zustandAdapter("cart", useCart).capture()).toEqual({ items: ["x"], coupon: null });
  });
});
