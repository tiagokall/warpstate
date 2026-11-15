import type { WarpSnapshot } from "./schema";

/**
 * How the data cache in a snapshot is used:
 * - `"restore"` (default): the cached server data is restored; nothing is fetched.
 * - `"refetch"`: route, history and stores are restored, but the data cache is
 *   dropped so the app fetches it from the server. Use it when a test checks
 *   server behaviour or the data must be current.
 */
export type WarpQueryMode = "restore" | "refetch";

/** Applies a {@link WarpQueryMode} to a snapshot (returns a copy for `"refetch"`). */
export function applyQueryMode(snapshot: WarpSnapshot, mode: WarpQueryMode = "restore"): WarpSnapshot {
  if (mode !== "refetch" || snapshot.query === undefined) return snapshot;
  const { query: _query, ...rest } = snapshot;
  return rest;
}
