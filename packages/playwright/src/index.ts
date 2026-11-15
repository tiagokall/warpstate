import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import {
  WarpError,
  applyQueryMode,
  createInitScript,
  decodeSnapshot,
  encodeSnapshot,
  isEncodedSnapshot,
  serializeSnapshot,
  type WarpGlobal,
  type WarpQueryMode,
  type WarpSnapshot,
} from "@warpstate/core";
import { failureSnapshotFixtures, type FailureSnapshotFixtures } from "./failure";

export { failureSnapshotFixtures, failureSnapshotName, type FailureSnapshotFixtures, type WarpCaptureMode } from "./failure";

export interface WarpOptions {
  /**
   * URL to open. Defaults to the snapshot's current history entry, so `page.url()`
   * starts out matching the scenario. Relative URLs use the configured `baseURL`.
   */
  url?: string;
  /** Wait for `window.__WARPSTATE__.ready`. Default: `true`. */
  waitForReady?: boolean;
  /** Milliseconds to wait for hydration. Default: `15000`. */
  timeout?: number;
  /**
   * `"refetch"` restores route, history and stores but lets the app fetch its
   * data from the server, for tests that check server behaviour. Default: `"restore"`.
   */
  query?: WarpQueryMode;
}

/** A snapshot object, a path to a `.warp.json` / `.warp` file, a JSON string or a compact `warp1.` string. */
export type SnapshotInput = WarpSnapshot | string;

function looksLikeInlineSnapshot(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith("{") || isEncodedSnapshot(trimmed);
}

/** Loads and validates a snapshot, with errors that name the file. */
export async function loadSnapshotInput(input: SnapshotInput | unknown): Promise<WarpSnapshot> {
  if (typeof input !== "string" || looksLikeInlineSnapshot(input)) {
    return decodeSnapshot(input, { source: "inline snapshot" });
  }
  const path = resolve(input);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (cause) {
    throw new WarpError("INVALID_SNAPSHOT", `Cannot read snapshot file ${path}.`, { cause });
  }
  return decodeSnapshot(content.trim(), { source: path });
}

type GlobalState = Pick<WarpGlobal, "status" | "error" | "warnings"> | null;

async function readGlobal(page: Page): Promise<GlobalState> {
  return page.evaluate(() => {
    const g = window.__WARPSTATE__;
    return g ? { status: g.status, error: g.error, warnings: g.warnings } : null;
  });
}

/**
 * Waits until the app finished hydrating from the injected snapshot and throws a
 * descriptive error when it was rejected or never picked up.
 */
export async function waitForWarp(page: Page, options: { timeout?: number } = {}): Promise<void> {
  const timeout = options.timeout ?? 15_000;
  try {
    await page.waitForFunction(
      () => {
        const status = window.__WARPSTATE__?.status;
        return status === "ready" || status === "error";
      },
      undefined,
      { timeout },
    );
  } catch (cause) {
    const state = await readGlobal(page).catch(() => null);
    const hint =
      state?.status === "hydrating"
        ? "The app accepted the snapshot but the initial route never rendered. Is <RouterProvider> mounted?"
        : "The app never picked up the snapshot. Does it create its router with createWarpRouter()? " +
          "Is it a production build where @warpstate/vite stripped the runtime?";
    throw new WarpError(
      "ADAPTER_FAILED",
      `warpstate did not become ready within ${timeout}ms (status: ${state?.status ?? "missing"}). ${hint}`,
      { cause },
    );
  }

  const state = await readGlobal(page);
  if (state?.status === "error") {
    throw new WarpError(
      (state.error?.code as WarpError["code"]) ?? "ADAPTER_FAILED",
      `The app rejected the snapshot [${state.error?.code}]: ${state.error?.message}`,
    );
  }
}

/**
 * Opens the app directly in the state described by a snapshot.
 *
 * Injects the snapshot before any app code runs, navigates, and waits until the
 * initial route rendered with restored state. Returns the validated snapshot.
 * The snapshot is re-applied on every navigation of this page (including reloads).
 */
export async function warp(page: Page, input: SnapshotInput, options: WarpOptions = {}): Promise<WarpSnapshot> {
  const snapshot = applyQueryMode(await loadSnapshotInput(input), options.query);
  await page.addInitScript({ content: createInitScript(snapshot) });
  const url = options.url ?? snapshot.router.entries[snapshot.router.index] ?? "/";
  await page.goto(url);
  if (options.waitForReady !== false) await waitForWarp(page, { timeout: options.timeout });
  return snapshot;
}

/** Captures the app's current state from inside a test. */
export async function captureWarp(page: Page, meta?: WarpSnapshot["meta"]): Promise<WarpSnapshot> {
  const snapshot = await page.evaluate((m) => {
    const g = window.__WARPSTATE__;
    if (!g?.capture) throw new Error("warpstate runtime not found on this page.");
    return g.capture(m);
  }, meta);
  return decodeSnapshot(snapshot, { source: "captureWarp" });
}

/** Writes a snapshot to disk: pretty JSON for `.json` paths, the compact form otherwise. */
export async function saveSnapshot(path: string, snapshot: WarpSnapshot): Promise<void> {
  const content = path.endsWith(".json") ? serializeSnapshot(snapshot) : `${await encodeSnapshot(snapshot)}\n`;
  await writeFile(resolve(path), content, "utf8");
}

/** Current router href (the browser URL does not follow navigation while warping). */
export async function warpLocation(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__WARPSTATE__?.location?.());
}

export interface WarpFixtures {
  /** `warp(page, snapshot, options)` bound to the test's page. */
  warp: (input: SnapshotInput, options?: WarpOptions) => Promise<WarpSnapshot>;
}

/** Fixture definitions to spread into your own `test.extend()`. */
export const warpFixtures: Parameters<typeof base.extend<WarpFixtures>>[0] = {
  warp: async ({ page }, use) => {
    await use((input, options) => warp(page, input, options));
  },
};

/**
 * Playwright `test` with a `warp` fixture, plus an auto fixture that saves a
 * snapshot of the app when a test fails (see {@link failureSnapshotFixtures}).
 */
export const test = base.extend<WarpFixtures & FailureSnapshotFixtures>({ ...warpFixtures, ...failureSnapshotFixtures });
export { expect };
export type { WarpSnapshot };
