import { create } from "zustand";
import type { Product } from "./api";

export interface CartItem {
  productId: number;
  title: string;
  price: number;
  qty: number;
}

const COUPONS: Record<string, number> = { WARP10: 0.1, HALFOFF: 0.5 };

interface CartState {
  items: CartItem[];
  coupon: string | null;
  add: (product: Product) => void;
  remove: (productId: number) => void;
  applyCoupon: (code: string) => boolean;
  clear: () => void;
}

export const useCart = create<CartState>()((set) => ({
  items: [],
  coupon: null,
  add: (product) =>
    set((state) => {
      const existing = state.items.find((i) => i.productId === product.id);
      return {
        items: existing
          ? state.items.map((i) => (i.productId === product.id ? { ...i, qty: i.qty + 1 } : i))
          : [...state.items, { productId: product.id, title: product.title, price: product.price, qty: 1 }],
      };
    }),
  remove: (productId) => set((state) => ({ items: state.items.filter((i) => i.productId !== productId) })),
  applyCoupon: (code) => {
    const valid = code.toUpperCase() in COUPONS;
    if (valid) set({ coupon: code.toUpperCase() });
    return valid;
  },
  clear: () => set({ items: [], coupon: null }),
}));

export function cartTotals(items: CartItem[], coupon: string | null) {
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const discount = coupon ? Math.round(subtotal * (COUPONS[coupon] ?? 0) * 100) / 100 : 0;
  return { subtotal, discount, total: subtotal - discount };
}

export interface ShippingInfo {
  name: string;
  street: string;
  city: string;
}

interface CheckoutState {
  shipping: ShippingInfo;
  payment: "card" | "pix" | null;
  setShipping: (shipping: ShippingInfo) => void;
  setPayment: (payment: "card" | "pix") => void;
  reset: () => void;
}

const emptyShipping: ShippingInfo = { name: "", street: "", city: "" };

export const useCheckout = create<CheckoutState>()((set) => ({
  shipping: emptyShipping,
  payment: null,
  setShipping: (shipping) => set({ shipping }),
  setPayment: (payment) => set({ payment }),
  reset: () => set({ shipping: emptyShipping, payment: null }),
}));
