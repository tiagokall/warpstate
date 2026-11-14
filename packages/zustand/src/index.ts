import type { WarpAdapter } from "@warpstate/core";

/** The part of a Zustand store (vanilla or the `create()` hook) the adapter needs. */
export interface ZustandLikeStore<T> {
  getState: () => T;
  setState: (partial: T | Partial<T>, replace?: false) => void;
}

export interface ZustandAdapterOptions<T, S> {
  /**
   * Picks what to capture. By default every non-function field is captured
   * (actions are functions and are left out).
   */
  partialize?: (state: T) => S;
  /**
   * Builds the next state from captured data. By default the data is shallow
   * merged into the current state, which keeps actions intact.
   */
  merge?: (captured: S, current: T) => T | Partial<T>;
}

function withoutFunctions<T>(state: T): Partial<T> {
  if (typeof state !== "object" || state === null) return state as Partial<T>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== "function") out[key] = value;
  }
  return out as Partial<T>;
}

/**
 * Captures and restores a Zustand store under `snapshot.stores[name]`.
 *
 * @example
 * const useCart = create<CartState>()((set) => ({ items: [], add: (item) => set(...) }));
 * createWarpRouter({ routeTree, warp: { adapters: [zustandAdapter("cart", useCart)] } });
 */
export function zustandAdapter<T, S = Partial<T>>(
  name: string,
  store: ZustandLikeStore<T>,
  options: ZustandAdapterOptions<T, S> = {},
): WarpAdapter<S> {
  return {
    name,
    capture: () =>
      options.partialize ? options.partialize(store.getState()) : (withoutFunctions(store.getState()) as S),
    restore: (data) => {
      store.setState(options.merge ? options.merge(data, store.getState()) : (data as Partial<T>));
    },
  };
}
