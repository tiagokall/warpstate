import {
  dehydrate,
  hashKey,
  hydrate,
  type DehydrateOptions,
  type DehydratedState,
  type HydrateOptions,
  type Query,
  type QueryClient,
  type QueryKey,
} from "@tanstack/query-core";
import type { WarpAdapter } from "@warpstate/core";

export interface QueryAdapterOptions {
  /** Passed to `dehydrate()`. By default only successful queries are captured. */
  dehydrate?: DehydrateOptions;
  /**
   * Which queries to capture:
   * - `"all"` (default): everything in the cache, so going Back through the
   *   restored history works offline too.
   * - `"active"`: only queries some mounted component is using (the current
   *   screen). Much smaller snapshots in apps that prefetch heavily; other
   *   screens fetch their data when visited.
   */
  capture?: "all" | "active";
  /** Passed to `hydrate()`. */
  hydrate?: HydrateOptions;
  /**
   * Drop fields `hydrate()` does not need (fetch counters, null errors, default
   * hashes…), which typically shrinks the cache by a third. Default: `true`.
   */
  compact?: boolean;
  /**
   * Stamp restored queries as fetched "now", so they are not immediately stale
   * just because the snapshot is old. Default: `true`.
   */
  freshen?: boolean;
  /**
   * While booting from a snapshot, make restored data authoritative: set the
   * client's default `staleTime` to `Infinity` and disable focus/reconnect
   * refetches and retries. Per-query options still win. Invalidations (e.g. after
   * a mutation) keep working. Default: `true`.
   */
  freeze?: boolean;
}

/** Compact, JSON-friendly form of a dehydrated query. */
export interface WarpQuery {
  queryKey: QueryKey;
  /** Only present when it differs from the default hash of `queryKey`. */
  queryHash?: string;
  state: {
    data?: unknown;
    status: "pending" | "error" | "success";
    dataUpdatedAt?: number;
    error?: unknown;
    errorUpdatedAt?: number;
  };
  meta?: Record<string, unknown>;
}

export interface WarpQueryState {
  queries: WarpQuery[];
  mutations?: DehydratedState["mutations"];
}

function compactState(state: DehydratedState): WarpQueryState {
  const queries = state.queries.map((query): WarpQuery => {
    const s = query.state;
    const out: WarpQuery = {
      queryKey: query.queryKey,
      state: { status: s.status, ...(s.data !== undefined ? { data: s.data } : {}) },
    };
    if (s.dataUpdatedAt) out.state.dataUpdatedAt = s.dataUpdatedAt;
    if (s.error != null) {
      out.state.error = s.error;
      out.state.errorUpdatedAt = s.errorUpdatedAt;
    }
    if (query.queryHash !== hashKey(query.queryKey)) out.queryHash = query.queryHash;
    if (query.meta) out.meta = query.meta;
    return out;
  });
  return state.mutations.length ? { queries, mutations: state.mutations } : { queries };
}

function expandState(state: WarpQueryState | DehydratedState, freshen: boolean): DehydratedState {
  const now = Date.now();
  return {
    mutations: state.mutations ?? [],
    queries: state.queries.map((query) => {
      const s = query.state as WarpQuery["state"] & Record<string, unknown>;
      const { promise: _promise, dehydratedAt: _at, ...rest } = query as WarpQuery & {
        promise?: unknown;
        dehydratedAt?: number;
      };
      return {
        ...rest,
        queryHash: query.queryHash ?? hashKey(query.queryKey),
        state: {
          dataUpdateCount: 1,
          errorUpdateCount: 0,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          isInvalidated: false,
          error: null,
          ...s,
          data: s.data,
          dataUpdatedAt: freshen && s.data !== undefined ? now : (s.dataUpdatedAt ?? 0),
          fetchStatus: "idle",
        },
      } as DehydratedState["queries"][number];
    }),
  };
}

/**
 * Captures and restores a TanStack Query cache (`dehydrate`/`hydrate`).
 * Registered under the reserved name `"query"`, stored in `snapshot.query`.
 */
export function queryAdapter(
  queryClient: QueryClient,
  options: QueryAdapterOptions = {},
): WarpAdapter<WarpQueryState | DehydratedState> {
  const { compact = true, freshen = true, freeze = true } = options;
  return {
    name: "query",
    capture() {
      const base = options.dehydrate?.shouldDehydrateQuery ?? ((query: Query) => query.state.status === "success");
      const state = dehydrate(queryClient, {
        ...options.dehydrate,
        shouldDehydrateQuery:
          options.capture === "active" ? (query) => query.getObserversCount() > 0 && base(query) : base,
      });
      return compact ? compactState(state) : state;
    },
    restore(data) {
      if (freeze) {
        const defaults = queryClient.getDefaultOptions();
        queryClient.setDefaultOptions({
          ...defaults,
          queries: {
            ...defaults.queries,
            staleTime: Infinity,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: false,
          },
        });
      }
      hydrate(queryClient, expandState(data, freshen), options.hydrate);
    },
  };
}
