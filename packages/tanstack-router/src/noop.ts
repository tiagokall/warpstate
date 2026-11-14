/** Production stand-in for `@warpstate/tanstack-router`, swapped in by `@warpstate/vite`. */
import { createRouter } from "@tanstack/react-router";
import type * as Real from "./index";

export type * from "./index";

export const createWarpRouter = ((options: Parameters<typeof Real.createWarpRouter>[0]) => {
  const { warp: _warp, ...routerOptions } = options;
  return createRouter(routerOptions as Parameters<typeof createRouter>[0]);
}) as typeof Real.createWarpRouter;

export const routerAdapter: typeof Real.routerAdapter = () => ({
  name: "router",
  capture: () => ({ entries: ["/"], index: 0 }),
  restore: () => undefined,
  dispose: () => undefined,
});

export const createSnapshotHistory = (() => {
  throw new Error("[warpstate] createSnapshotHistory is not available in production builds.");
}) as typeof Real.createSnapshotHistory;

export const HistoryTracker = class {
  constructor() {
    throw new Error("[warpstate] HistoryTracker is not available in production builds.");
  }
} as unknown as typeof Real.HistoryTracker;

export const HISTORY_STORAGE_KEY: typeof Real.HISTORY_STORAGE_KEY = "warpstate:history";
