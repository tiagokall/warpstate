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
  /**
   * While booted from a snapshot, the router runs on a memory history, so the
   * browser's address bar would keep showing the URL the page was opened with.
   * When `true`, the current route is mirrored into it with `replaceState`, so
   * copying the URL or opening it in a new tab lands on the same route (with live
   * data). Default: `true`.
   */
  mirrorUrl?: boolean;
}

/** `href` with extra query params appended before the hash. */
function withParams(href: string, params: string | undefined): string {
  if (!params) return href;
  const hashAt = href.indexOf("#");
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  return `${path}${path.includes("?") ? "&" : "?"}${params}${hash}`;
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
  const { adapters = [], mirrorUrl = true, ...config } = warp ?? {};

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

  if (snapshot && mirrorUrl && typeof window !== "undefined") {
    const mirror = () => {
      try {
        // keepParams: e.g. "warp=checkout-review" for ?warp= links, so a reload
        // reopens the same scenario instead of the bare route.
        const url = withParams(router.history.location.href, getWarpGlobal()?.keepParams);
        if (url !== window.location.pathname + window.location.search + window.location.hash) {
          window.history.replaceState(window.history.state, "", url);
        }
      } catch {
        // Sandboxed frames and some test environments refuse replaceState.
      }
    };
    mirror();
    router.history.subscribe(mirror);
  }

  if (snapshot) {
    // Newer versions emit onResolved then onRendered after the initial render; older
    // ones (≤ 1.140) only emit onResolved, from a layout effect after commit. Take
    // whichever comes first and yield one task so the DOM is committed either way.
    let settled = false;
    const unsubscribers: Array<() => void> = [];
    const settle = () => {
      if (settled) return;
      settled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      setTimeout(() => void markWarpReady(), 0);
    };
    unsubscribers.push(router.subscribe("onRendered", settle), router.subscribe("onResolved", settle));
  }

  return router;
}
