import { createMemoryHistory, type RouterHistory } from "@tanstack/react-router";
import { INTERNAL_STORAGE_PREFIX, type WarpRouterState } from "@warpstate/core";

/**
 * Creates a memory history positioned at `state.index`.
 *
 * `createMemoryHistory({ initialIndex })` treats `0` as "not provided" and starts
 * at the last entry, and it mutates the `initialEntries` array in place. We pass a
 * copy, start at the last entry and step back with `go()`, which runs synchronously
 * when no navigation blockers are registered (always true before the router exists).
 */
export function createSnapshotHistory(state: WarpRouterState): RouterHistory {
  const entries = [...state.entries];
  const last = entries.length - 1;
  const history = createMemoryHistory({ initialEntries: entries, initialIndex: last });
  if (state.index !== last) history.go(state.index - last);

  if (history.location.href !== state.entries[state.index] && history.location.state.__TSR_index !== state.index) {
    // Defensive: if a future version makes go() asynchronous, fall back to initialIndex.
    return createMemoryHistory({ initialEntries: [...state.entries], initialIndex: state.index });
  }
  return history;
}

export const HISTORY_STORAGE_KEY = `${INTERNAL_STORAGE_PREFIX}history`;

interface PersistedHistory {
  entries: Array<[number, string]>;
}

/**
 * Records every history entry the app visits, keyed by TanStack's `__TSR_index`,
 * so the whole back/forward stack can be captured — the browser's History API
 * only exposes the current URL.
 */
export class HistoryTracker {
  private readonly known = new Map<number, string>();
  private current: number;
  private readonly persistEnabled: boolean;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly history: RouterHistory,
    options: { seed?: WarpRouterState; persist?: boolean } = {},
  ) {
    const location = history.location;
    this.current = readIndex(location.state) ?? 0;

    if (options.seed) {
      options.seed.entries.forEach((href, i) => this.known.set(i, href));
    } else if (options.persist) {
      const persisted = loadPersisted();
      // Only trust the persisted stack if it agrees with where the browser is now.
      if (persisted && persisted.get(this.current) === location.href) {
        persisted.forEach((href, i) => this.known.set(i, href));
      }
    }
    this.known.set(this.current, location.href);
    this.persistEnabled = options.persist ?? false;
    this.persist();

    this.unsubscribe = history.subscribe(({ location: next, action }) => {
      const stateIndex = readIndex(next.state);
      if (stateIndex !== undefined) this.current = stateIndex;
      else if (action.type === "PUSH" || action.type === "FORWARD") this.current += 1;
      else if (action.type === "BACK") this.current -= 1;
      else if (action.type === "GO") this.current += action.index;

      if (action.type === "PUSH") {
        for (const i of [...this.known.keys()]) if (i > this.current) this.known.delete(i);
      }
      this.known.set(this.current, next.href);
      this.persist();
    });
  }

  /** Longest contiguous run of known entries around the current one. */
  snapshot(): WarpRouterState {
    let start = this.current;
    while (this.known.has(start - 1)) start -= 1;
    let end = this.current;
    while (this.known.has(end + 1)) end += 1;
    const entries: string[] = [];
    for (let i = start; i <= end; i += 1) entries.push(this.known.get(i)!);
    return { entries, index: this.current - start };
  }

  dispose(): void {
    this.unsubscribe();
  }

  private persist(): void {
    if (!this.persistEnabled || typeof sessionStorage === "undefined") return;
    try {
      const data: PersistedHistory = { entries: [...this.known.entries()] };
      sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or disabled: capture still works, it just forgets entries on reload.
    }
  }
}

function readIndex(state: unknown): number | undefined {
  const value = (state as { __TSR_index?: unknown } | undefined)?.__TSR_index;
  return typeof value === "number" ? value : undefined;
}

function loadPersisted(): Map<number, string> | undefined {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return undefined;
    const data = JSON.parse(raw) as PersistedHistory;
    return new Map(data.entries.filter(([i, href]) => Number.isInteger(i) && typeof href === "string"));
  } catch {
    return undefined;
  }
}
