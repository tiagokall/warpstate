import { hasWindow, isProductionEnv } from "./env";
import { WarpError, isWarpError } from "./errors";
import { getWarpGlobal } from "./global";
import { safeParseSnapshot } from "./parse";
import { WARP_FORMAT_VERSION, type WarpRouterState, type WarpSnapshot } from "./schema";
import { decodeValue, encodeValue, findNonSerializable } from "./serializable";
import { decodeSnapshot } from "./encoding";
import { PENDING_STORAGE_KEY, takePendingSnapshot } from "./pending";
import { captureStorage, restoreStorage, type StorageCaptureOptions } from "./storage";

/**
 * Connects one piece of app state to warpstate.
 *
 * `capture` must return JSON-serializable data. `restore` runs once, as soon as the
 * adapter is registered, when the app was booted from a snapshot that contains data
 * for this adapter's `name`.
 *
 * The names `"router"` and `"query"` are reserved: their data lives in the
 * snapshot's `router` and `query` fields instead of `stores`.
 */
export interface WarpAdapter<T = unknown> {
  name: string;
  capture(): T;
  restore(data: T): void | Promise<void>;
}

export interface MigrationContext {
  /** `app.schemaVersion` stored in the snapshot (if any). */
  from: string | undefined;
  /** `app.schemaVersion` configured in the running app. */
  to: string;
}

export interface WarpConfig {
  /**
   * Identifies the app. `schemaVersion` should change whenever the shape of
   * captured state changes; snapshots with another version are rejected as
   * obsolete unless `migrate` upgrades them.
   */
  app?: { name?: string; schemaVersion?: string };
  /**
   * Upgrades a snapshot captured with another `app.schemaVersion`.
   * Return the migrated snapshot, or `null`/`undefined` to reject it as obsolete.
   */
  migrate?: (snapshot: WarpSnapshot, context: MigrationContext) => WarpSnapshot | null | undefined;
  /**
   * Allow hydrating snapshots in production builds. Off by default so a
   * production app can never be driven into an arbitrary state by injected data.
   */
  allowInProduction?: boolean;
  /** Fail (instead of warn) when the snapshot has store data no adapter claims. */
  strict?: boolean;
  /** Which Web Storage keys `captureSnapshot` includes. Nothing by default. */
  captureStorage?: StorageCaptureOptions;
}

/** Helper for authoring adapters with full type inference. */
export function defineAdapter<T>(adapter: WarpAdapter<T>): WarpAdapter<T> {
  return adapter;
}

type AnyAdapter = WarpAdapter<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Runtime {
  config: WarpConfig;
  adapters: Map<string, AnyAdapter>;
  /** `undefined` until the injected snapshot was resolved; `null` when there is none. */
  snapshot: WarpSnapshot | null | undefined;
  restored: Set<string>;
  pending: Promise<unknown>[];
}

const RUNTIME_KEY = Symbol.for("warpstate.runtime");

/** Single runtime per page, even if several copies of this module get bundled. */
function runtime(): Runtime {
  const holder = globalThis as unknown as { [RUNTIME_KEY]?: Runtime };
  return (holder[RUNTIME_KEY] ??= {
    config: {},
    adapters: new Map(),
    snapshot: undefined,
    restored: new Set(),
    pending: [],
  });
}

/** Merges options into the global warpstate configuration. Call before registering adapters. */
export function configureWarp(config: WarpConfig): void {
  const rt = runtime();
  rt.config = {
    ...rt.config,
    ...config,
    app: config.app ? { ...rt.config.app, ...config.app } : rt.config.app,
  };
}

export function getWarpConfig(): Readonly<WarpConfig> {
  return runtime().config;
}

/** Marks hydration as failed and exposes the reason on `window.__WARPSTATE__`. */
export function failWarp(error: unknown): void {
  const warpError = isWarpError(error)
    ? error
    : new WarpError("ADAPTER_FAILED", error instanceof Error ? error.message : String(error), {
        cause: error,
      });
  const global = getWarpGlobal();
  console.error(`[warpstate] ${warpError.message}`);
  if (!global || global.status === "error") return;
  global.status = "error";
  global.error = { code: warpError.code, message: warpError.message };
  global._settle?.(global.error);
}

function warn(message: string): void {
  console.warn(`[warpstate] ${message}`);
  getWarpGlobal()?.warnings.push(message);
}

function checkAppIdentity(snapshot: WarpSnapshot, config: WarpConfig): WarpSnapshot {
  const expectedName = config.app?.name;
  const actualName = snapshot.app?.name;
  if (expectedName && actualName && expectedName !== actualName) {
    throw new WarpError(
      "APP_MISMATCH",
      `Snapshot was captured from app "${actualName}" but this is "${expectedName}".`,
    );
  }

  const to = config.app?.schemaVersion;
  const from = snapshot.app?.schemaVersion;
  if (to === undefined || from === to) return snapshot;

  const obsolete = new WarpError(
    "OBSOLETE_SNAPSHOT",
    `Snapshot "${snapshot.meta?.name ?? "unnamed"}" has schemaVersion ${JSON.stringify(from ?? null)} ` +
      `but the app expects ${JSON.stringify(to)}. Re-capture it or add a \`migrate\` hook.`,
  );
  if (!config.migrate) throw obsolete;

  const migrated = config.migrate(snapshot, { from, to });
  if (!migrated) throw obsolete;
  const reparsed = safeParseSnapshot(migrated, { source: `migrate(${from ?? "none"} → ${to})` });
  if (!reparsed.success) throw reparsed.error;
  return { ...reparsed.snapshot, app: { ...reparsed.snapshot.app, schemaVersion: to } };
}

/**
 * Returns the validated snapshot the app should boot from, or `null` when the app
 * should boot normally (no snapshot, production guard, or invalid snapshot).
 * The result is computed once and cached.
 */
export function getActiveSnapshot(): WarpSnapshot | null {
  const rt = runtime();
  if (rt.snapshot !== undefined) return rt.snapshot;
  rt.snapshot = null;

  const global = getWarpGlobal();
  if (!global) return null;
  if (global.snapshot == null) {
    // Queued by loadSnapshot() (devtools, agents) right before a reload.
    const pending = takePendingSnapshot();
    if (pending === undefined) return null;
    global.snapshot = pending;
    global.status = "pending";
  }

  if (isProductionEnv() && !rt.config.allowInProduction) {
    failWarp(
      new WarpError(
        "PRODUCTION_BLOCKED",
        "A snapshot was injected into a production build and ignored. " +
          "Set `allowInProduction: true` if this is intentional (e.g. a staging e2e run).",
      ),
    );
    return null;
  }

  const parsed = safeParseSnapshot(global.snapshot, { source: "window.__WARPSTATE__.snapshot" });
  if (!parsed.success) {
    failWarp(parsed.error);
    return null;
  }

  let snapshot: WarpSnapshot;
  try {
    snapshot = checkAppIdentity(parsed.snapshot, rt.config);
  } catch (error) {
    failWarp(error);
    return null;
  }

  if (snapshot.storage && !global.storageRestored) {
    restoreStorage(snapshot.storage);
    global.storageRestored = true;
  }

  global.status = "hydrating";
  rt.snapshot = snapshot;
  return snapshot;
}

/** True when the app is booting from a snapshot. */
export function isWarping(): boolean {
  return getActiveSnapshot() !== null;
}

function dataFor(snapshot: WarpSnapshot, name: string): unknown {
  if (name === "router") return snapshot.router;
  if (name === "query") return snapshot.query;
  return snapshot.stores?.[name];
}

function restoreAdapter(adapter: AnyAdapter, snapshot: WarpSnapshot): void {
  const rt = runtime();
  if (rt.restored.has(adapter.name)) return;
  rt.restored.add(adapter.name);

  const data = adapter.name === "router" ? dataFor(snapshot, adapter.name) : decodeValue(dataFor(snapshot, adapter.name));
  if (data === undefined) return;

  const fail = (cause: unknown) =>
    failWarp(
      new WarpError(
        "ADAPTER_FAILED",
        `Adapter "${adapter.name}" failed to restore: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      ),
    );
  try {
    const result = adapter.restore(data);
    if (result && typeof (result as Promise<void>).then === "function") {
      rt.pending.push(Promise.resolve(result).catch(fail));
    }
  } catch (cause) {
    fail(cause);
  }
}

/**
 * Registers an adapter. When the app is booting from a snapshot, the adapter's
 * data is restored immediately (synchronously, unless `restore` returns a promise).
 * Returns a function that unregisters the adapter.
 */
export function registerAdapter<T>(adapter: WarpAdapter<T>): () => void {
  const rt = runtime();
  if (rt.adapters.has(adapter.name) && rt.adapters.get(adapter.name) !== adapter) {
    warn(`An adapter named "${adapter.name}" was already registered; replacing it.`);
  }
  rt.adapters.set(adapter.name, adapter);

  const snapshot = getActiveSnapshot();
  if (snapshot) restoreAdapter(adapter, snapshot);

  return () => {
    if (rt.adapters.get(adapter.name) === adapter) rt.adapters.delete(adapter.name);
  };
}

export function getAdapters(): ReadonlyMap<string, WarpAdapter<unknown>> {
  return runtime().adapters;
}

/**
 * Called by the router integration once the initial route has rendered.
 * Waits for async adapter restores, reports unclaimed store data and resolves
 * `window.__WARPSTATE__.ready`.
 */
export async function markWarpReady(): Promise<void> {
  const rt = runtime();
  const global = getWarpGlobal();
  if (!global || !rt.snapshot || global.status !== "hydrating") return;

  await Promise.all(rt.pending);
  if (global.status !== "hydrating") return; // an async restore failed

  const unclaimed = Object.keys(rt.snapshot.stores ?? {}).filter((name) => !rt.adapters.has(name));
  if (unclaimed.length) {
    const message =
      `Snapshot has data for ${unclaimed.map((n) => `"${n}"`).join(", ")} but no adapter with ` +
      `that name was registered.`;
    if (rt.config.strict) {
      failWarp(new WarpError("UNKNOWN_STORE", message));
      return;
    }
    warn(message);
  }

  global.status = "ready";
  global._settle?.();
}

function fallbackRouterState(): WarpRouterState {
  if (!hasWindow()) return { entries: ["/"], index: 0 };
  const { pathname, search, hash } = window.location;
  return { entries: [`${pathname}${search}${hash}`], index: 0 };
}

export interface CaptureResult {
  snapshot: WarpSnapshot;
  /** Values that will not survive JSON serialization, by path. */
  warnings: string[];
}

/** Captures the current state of every registered adapter. */
export function captureSnapshotWithReport(meta?: WarpSnapshot["meta"]): CaptureResult {
  const rt = runtime();
  const stores: Record<string, unknown> = {};
  let router: WarpRouterState | undefined;
  let query: unknown;

  for (const [name, adapter] of rt.adapters) {
    const raw: unknown = adapter.capture();
    if (name === "router") {
      router = raw as WarpRouterState;
      continue;
    }
    // Map, Set, Date and bigint survive as tagged objects (see encodeValue).
    const data = encodeValue(raw);
    if (name === "query") query = data;
    else if (data !== undefined) stores[name] = data;
  }

  const snapshot: WarpSnapshot = {
    warpstate: WARP_FORMAT_VERSION,
    ...(rt.config.app ? { app: { ...rt.config.app } } : {}),
    meta: { ...meta, createdAt: meta?.createdAt ?? new Date().toISOString() },
    router: router ?? fallbackRouterState(),
  };
  if (Object.keys(stores).length) snapshot.stores = stores;
  if (query !== undefined) snapshot.query = query;
  const storage = rt.config.captureStorage ? captureStorage(rt.config.captureStorage) : undefined;
  if (storage) snapshot.storage = storage;

  const warnings = [
    ...findNonSerializable(snapshot.stores, "stores"),
    ...findNonSerializable(snapshot.query, "query"),
  ];
  return { snapshot, warnings };
}

/** Captures the current state of every registered adapter, warning about non-serializable values. */
export function captureSnapshot(meta?: WarpSnapshot["meta"]): WarpSnapshot {
  const { snapshot, warnings } = captureSnapshotWithReport(meta);
  if (warnings.length) {
    console.warn(
      `[warpstate] Some captured values are not JSON-serializable and will not restore faithfully:\n` +
        warnings.map((w) => `  - ${w}`).join("\n"),
    );
  }
  return snapshot;
}

/**
 * Validates a snapshot (object, JSON or compact `warp1.` string), queues it in
 * sessionStorage and reloads the page so the app boots from it. This is how
 * devtools and agents load a snapshot into an already running app.
 */
export async function loadSnapshot(
  input: unknown,
  options: { reload?: boolean } = {},
): Promise<WarpSnapshot> {
  const snapshot = await decodeSnapshot(input, { source: "loadSnapshot" });
  if (isProductionEnv() && !runtime().config.allowInProduction) {
    throw new WarpError("PRODUCTION_BLOCKED", "Loading snapshots is disabled in production builds.");
  }
  sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(snapshot));
  if (options.reload !== false) window.location.reload();
  return snapshot;
}

/**
 * Wires `window.__WARPSTATE__.capture` and resolves the snapshot. Integrations call
 * this once at boot; it is safe to call more than once.
 */
export function initWarp(config?: WarpConfig): WarpSnapshot | null {
  if (config) configureWarp(config);
  const global = getWarpGlobal();
  if (global) {
    global.capture = captureSnapshot;
    global.load = (input) => loadSnapshot(input).then(() => undefined);
  }
  return getActiveSnapshot();
}

/** Clears all runtime state. Intended for tests. */
export function resetWarp(): void {
  const holder = globalThis as unknown as { [RUNTIME_KEY]?: Runtime };
  delete holder[RUNTIME_KEY];
  if (hasWindow()) delete window.__WARPSTATE__;
}
