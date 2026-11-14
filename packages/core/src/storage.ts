import type { WarpSnapshot } from "./schema";

/** `true` = every key, array = only these keys. */
export type StorageKeySelection = boolean | string[];

export interface StorageCaptureOptions {
  local?: StorageKeySelection;
  session?: StorageKeySelection;
}

/** Keys used by warpstate itself; never captured. */
export const INTERNAL_STORAGE_PREFIX = "warpstate:";

function readArea(area: Storage, selection: StorageKeySelection | undefined): Record<string, string> | undefined {
  if (!selection) return undefined;
  const keys =
    selection === true
      ? Array.from({ length: area.length }, (_, i) => area.key(i)).filter((k): k is string => k !== null)
      : selection;
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (key.startsWith(INTERNAL_STORAGE_PREFIX)) continue;
    const value = area.getItem(key);
    if (value !== null) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Reads the selected Web Storage keys. Nothing is captured unless explicitly selected,
 * because storage frequently holds auth tokens that must not end up in a committed file.
 */
export function captureStorage(options: StorageCaptureOptions): WarpSnapshot["storage"] | undefined {
  if (typeof window === "undefined") return undefined;
  const local = readArea(window.localStorage, options.local);
  const session = readArea(window.sessionStorage, options.session);
  if (!local && !session) return undefined;
  return { ...(local ? { local } : {}), ...(session ? { session } : {}) };
}

/** Writes snapshot storage entries into Web Storage. */
export function restoreStorage(storage: NonNullable<WarpSnapshot["storage"]>): void {
  if (typeof window === "undefined") return;
  for (const [key, value] of Object.entries(storage.local ?? {})) window.localStorage.setItem(key, value);
  for (const [key, value] of Object.entries(storage.session ?? {})) window.sessionStorage.setItem(key, value);
}
