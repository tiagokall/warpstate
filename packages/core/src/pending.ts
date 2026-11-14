import { INTERNAL_STORAGE_PREFIX } from "./storage";

/** sessionStorage key holding a snapshot to boot from on the next page load. */
export const PENDING_STORAGE_KEY = `${INTERNAL_STORAGE_PREFIX}pending`;

/** Reads and clears a snapshot queued by `loadSnapshot` before the last reload. */
export function takePendingSnapshot(): unknown {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (raw === null) return undefined;
    sessionStorage.removeItem(PENDING_STORAGE_KEY);
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
