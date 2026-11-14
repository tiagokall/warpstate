import type { WarpSnapshot } from "./schema";

/** Name of the global the test runner writes to and the app reads from. */
export const WARP_GLOBAL_KEY = "__WARPSTATE__";

/**
 * - `idle`: no snapshot was injected; the app boots normally.
 * - `pending`: a snapshot was injected but the app has not picked it up yet.
 * - `hydrating`: the app accepted the snapshot and is restoring state.
 * - `ready`: the initial route rendered with the restored state.
 * - `error`: the snapshot was rejected (see `error`).
 */
export type WarpStatus = "idle" | "pending" | "hydrating" | "ready" | "error";

export interface WarpGlobalError {
  code: string;
  message: string;
}

/** Shape of `window.__WARPSTATE__`. */
export interface WarpGlobal {
  /** Raw snapshot injected by the test runner (validated by the app before use). */
  snapshot?: unknown;
  status: WarpStatus;
  /** Resolves once the initial route has rendered with restored state; rejects on error. */
  ready: Promise<void>;
  error?: WarpGlobalError;
  /** Non-fatal problems found while hydrating (e.g. store data without an adapter). */
  warnings: string[];
  /** Set by the test runner when it already wrote `snapshot.storage` before boot. */
  storageRestored?: boolean;
  /** Current router href, provided by the router integration. */
  location?: () => string | undefined;
  /** Captures the current app state; available whenever the warpstate runtime is loaded. */
  capture?: (meta?: WarpSnapshot["meta"]) => WarpSnapshot;
  /** Loads a snapshot (object, JSON or compact string) by queueing it and reloading the page. */
  load?: (snapshot: unknown) => Promise<void>;
  /** @internal */
  _settle?: (error?: WarpGlobalError) => void;
}

declare global {
  interface Window {
    [WARP_GLOBAL_KEY]?: WarpGlobal;
  }
}

function createDeferred(): { promise: Promise<void>; settle: (error?: WarpGlobalError) => void } {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Rejections are reported through `status`/`error` too; avoid "unhandled rejection" noise.
  promise.catch(() => undefined);
  let settled = false;
  return {
    promise,
    settle: (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(Object.assign(new Error(error.message), { code: error.code }));
      else resolve();
    },
  };
}

/**
 * Returns `window.__WARPSTATE__`, creating it (or filling in missing fields) when needed.
 * Returns `undefined` outside the browser.
 */
export function getWarpGlobal(): WarpGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  const existing = window[WARP_GLOBAL_KEY] as Partial<WarpGlobal> | undefined;
  const target: Partial<WarpGlobal> = existing ?? {};

  if (!target.ready || !target._settle) {
    const deferred = createDeferred();
    target.ready = deferred.promise;
    target._settle = deferred.settle;
  }
  target.warnings ??= [];
  target.status ??= target.snapshot != null ? "pending" : "idle";

  window[WARP_GLOBAL_KEY] = target as WarpGlobal;
  return target as WarpGlobal;
}
