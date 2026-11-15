/**
 * Production stand-in for `@warpstate/core`, swapped in by `@warpstate/vite`.
 * Every export matches the real module's type but does nothing, so the warpstate
 * runtime (and zod) never reach a production bundle.
 */
import type * as Real from "./index";

export type * from "./index";

const noop = () => undefined;
const disabled = (what: string) => () => {
  throw new Error(`[warpstate] ${what} is not available in production builds.`);
};

export class WarpError extends Error {
  readonly code: Real.WarpErrorCode;
  constructor(code: Real.WarpErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WarpError";
    this.code = code;
  }
}

export const isWarpError: typeof Real.isWarpError = (value): value is Real.WarpError =>
  value instanceof WarpError;
export const WARP_FORMAT_VERSION: typeof Real.WARP_FORMAT_VERSION = 1;
export const WARP_FILE_EXTENSION: typeof Real.WARP_FILE_EXTENSION = ".warp.json";
export const RESERVED_ADAPTER_NAMES: typeof Real.RESERVED_ADAPTER_NAMES = ["router", "query"];
export const WARP_GLOBAL_KEY: typeof Real.WARP_GLOBAL_KEY = "__WARPSTATE__";
export const INTERNAL_STORAGE_PREFIX: typeof Real.INTERNAL_STORAGE_PREFIX = "warpstate:";
export const warpSnapshotSchema = undefined as unknown as typeof Real.warpSnapshotSchema;

export const parseSnapshot: typeof Real.parseSnapshot = disabled("parseSnapshot");
export const safeParseSnapshot: typeof Real.safeParseSnapshot = () => ({
  success: false,
  error: new WarpError("PRODUCTION_BLOCKED", "warpstate is disabled in production builds."),
});
export const isProductionEnv: typeof Real.isProductionEnv = () => true;
export const getWarpGlobal: typeof Real.getWarpGlobal = noop;
export const configureWarp: typeof Real.configureWarp = noop;
export const getWarpConfig: typeof Real.getWarpConfig = () => ({});
export const initWarp: typeof Real.initWarp = () => null;
export const getActiveSnapshot: typeof Real.getActiveSnapshot = () => null;
export const isWarping: typeof Real.isWarping = () => false;
export const registerAdapter: typeof Real.registerAdapter = () => noop;
export const getAdapters: typeof Real.getAdapters = () => new Map();
export const markWarpReady: typeof Real.markWarpReady = async () => undefined;
export const failWarp: typeof Real.failWarp = noop;
export const captureSnapshot: typeof Real.captureSnapshot = disabled("captureSnapshot");
export const captureSnapshotWithReport: typeof Real.captureSnapshotWithReport =
  disabled("captureSnapshotWithReport");
export const resetWarp: typeof Real.resetWarp = noop;
export const captureStorage: typeof Real.captureStorage = noop;
export const restoreStorage: typeof Real.restoreStorage = noop;
export const findNonSerializable: typeof Real.findNonSerializable = () => [];
export const applyQueryMode: typeof Real.applyQueryMode = (snapshot) => snapshot;
export const TYPE_TAG: typeof Real.TYPE_TAG = "$warp";
export const encodeValue: typeof Real.encodeValue = (value) => value;
export const decodeValue: typeof Real.decodeValue = (value) => value;
export const serializeSnapshot: typeof Real.serializeSnapshot = (s) => JSON.stringify(s);
export const snapshotFileName: typeof Real.snapshotFileName = () => "snapshot.warp.json";
export const downloadSnapshot: typeof Real.downloadSnapshot = noop;
export const copySnapshot: typeof Real.copySnapshot = async () => false;
export const parseShortcut: typeof Real.parseShortcut = disabled("parseShortcut");
export const matchesShortcut: typeof Real.matchesShortcut = () => false;
export const defineAdapter: typeof Real.defineAdapter = (adapter) => adapter;
export const loadSnapshot: typeof Real.loadSnapshot = disabled("loadSnapshot") as never;
export const createInitScript: typeof Real.createInitScript = disabled("createInitScript");
export const PENDING_STORAGE_KEY: typeof Real.PENDING_STORAGE_KEY = "warpstate:pending";
export const ENCODED_PREFIX: typeof Real.ENCODED_PREFIX = "warp1.";
export const encodeSnapshot: typeof Real.encodeSnapshot = disabled("encodeSnapshot") as never;
export const decodeSnapshot: typeof Real.decodeSnapshot = disabled("decodeSnapshot") as never;
export const isEncodedSnapshot: typeof Real.isEncodedSnapshot = (_value): _value is string => false;
