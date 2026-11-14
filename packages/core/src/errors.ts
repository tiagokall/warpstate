export type WarpErrorCode =
  | "INVALID_SNAPSHOT"
  | "UNSUPPORTED_FORMAT"
  | "OBSOLETE_SNAPSHOT"
  | "APP_MISMATCH"
  | "ADAPTER_FAILED"
  | "UNKNOWN_STORE"
  | "PRODUCTION_BLOCKED";

/** Error thrown (or reported through `window.__WARPSTATE__.error`) by warpstate. */
export class WarpError extends Error {
  readonly code: WarpErrorCode;

  constructor(code: WarpErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WarpError";
    this.code = code;
  }
}

export function isWarpError(value: unknown): value is WarpError {
  return value instanceof Error && value.name === "WarpError" && "code" in value;
}
