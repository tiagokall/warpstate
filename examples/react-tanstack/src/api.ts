/**
 * A fake backend with real latency. Every call is counted on `window.__apiCalls`
 * so e2e tests can prove that a warped scenario renders without fetching.
 */
export interface Product {
  id: number;
  title: string;
  price: number;
  description: string;
}

const PRODUCTS: Product[] = [
  { id: 1, title: "Warp Mug", price: 14, description: "Holds coffee across timelines." },
  { id: 2, title: "Snapshot Tee", price: 25, description: "Soft cotton, frozen in its best state." },
  { id: 3, title: "Hydration Bottle", price: 19, description: "Restores you in a single render." },
  { id: 4, title: "Router Cap", price: 22, description: "Keeps your history stack in place." },
  { id: 5, title: "Mug of Holding", price: 31, description: "A bigger mug. Much bigger." },
];

declare global {
  interface Window {
    __apiCalls?: string[];
    /** Overrides the simulated latency (benchmarks run with several values). */
    __API_LATENCY__?: number;
  }
}

const DEFAULT_LATENCY_MS = 600;

async function request<T>(name: string, produce: () => T): Promise<T> {
  (window.__apiCalls ??= []).push(name);
  await new Promise((resolve) => setTimeout(resolve, window.__API_LATENCY__ ?? DEFAULT_LATENCY_MS));
  return structuredClone(produce());
}

export type SortOrder = "relevance" | "price";

export function fetchProducts(q: string, sort: SortOrder): Promise<Product[]> {
  return request(`products?q=${q}&sort=${sort}`, () => {
    const matches = PRODUCTS.filter((p) => p.title.toLowerCase().includes(q.toLowerCase()));
    return sort === "price" ? [...matches].sort((a, b) => a.price - b.price) : matches;
  });
}

export function fetchProduct(id: number): Promise<Product> {
  return request(`product/${id}`, () => {
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) throw new Error(`Product ${id} not found`);
    return product;
  });
}

export function placeOrder(total: number): Promise<{ orderId: string; total: number }> {
  return request("order", () => ({ orderId: `WS-${1000 + Math.round(total)}`, total }));
}
