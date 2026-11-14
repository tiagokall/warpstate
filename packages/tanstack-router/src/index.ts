import {
  createRouter,
  type AnyRoute,
  type AnyRouter,
  type RouterConstructorOptions,
  type RouterHistory,
  type TrailingSlashOption,
} from "@tanstack/react-router";
import {
  getWarpGlobal,
  initWarp,
  markWarpReady,
  registerAdapter,
  type WarpAdapter,
  type WarpConfig,
  type WarpRouterState,
} from "@warpstate/core";
import { HistoryTracker, createSnapshotHistory } from "./history";

export { HistoryTracker, createSnapshotHistory, HISTORY_STORAGE_KEY } from "./history";

export interface WarpRouterOptions extends WarpConfig {
  /**
   * Adapters registered before the router is created, so their state is
   * restored before the first render.
   */
  adapters?: Array<WarpAdapter<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type WarpRouterAdapter = WarpAdapter<WarpRouterState> & { dispose(): void };

/**
 * Captures the router's full history stack. The router itself is restored by
 * `createWarpRouter` (through a memory history), so `restore` is a no-op.
 */
export function routerAdapter(
  router: Pick<AnyRouter, "history">,
  options: { seed?: WarpRouterState; persist?: boolean } = {},
): WarpRouterAdapter {
  const tracker = new HistoryTracker(router.history, options);
  return {
    name: "router",
    capture: () => tracker.snapshot(),
    restore: () => undefined,
    dispose: () => tracker.dispose(),
  };
}

/**
 * Drop-in replacement for TanStack Router's `createRouter`.
 *
 * Without a snapshot it behaves exactly like `createRouter` (browser history by
 * default). When the page was opened with a warpstate snapshot, it restores the
 * registered adapters, boots on a memory history holding the snapshot's history
 * stack and resolves `window.__WARPSTATE__.ready` after the first render.
 */
export function createWarpRouter<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption = "never",
  TDefaultStructuralSharingOption extends boolean = false,
  TRouterHistory extends RouterHistory = RouterHistory,
  TDehydrated extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
>(
  options: RouterConstructorOptions<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TRouterHistory,
    TDehydrated
  > & { warp?: WarpRouterOptions },
) {
  const { warp, ...routerOptions } = options;
  const { adapters = [], ...config } = warp ?? {};

  const snapshot = initWarp(config);
  for (const adapter of adapters) registerAdapter(adapter);

  if (snapshot && routerOptions.history) {
    console.warn("[warpstate] Ignoring the `history` option: booting from a snapshot uses a memory history.");
  }
  const history = snapshot ? createSnapshotHistory(snapshot.router) : routerOptions.history;

  const router = createRouter<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TRouterHistory,
    TDehydrated
  >({
    ...routerOptions,
    ...(history ? { history: history as TRouterHistory } : {}),
  } as unknown as RouterConstructorOptions<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TRouterHistory,
    TDehydrated
  >);

  registerAdapter(
    routerAdapter(router, snapshot ? { seed: snapshot.router } : { persist: true }),
  );

  const global = getWarpGlobal();
  if (global) global.location = () => router.history.location.href;

  if (snapshot) {
    const unsubscribe = router.subscribe("onRendered", () => {
      unsubscribe();
      void markWarpReady();
    });
  }

  return router;
}
