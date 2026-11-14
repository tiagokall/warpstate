// Bundlers replace this expression; declared locally to avoid depending on Node types.
declare const process: { env: { NODE_ENV?: string } };

/**
 * True when the bundle was built for production.
 *
 * Bundlers (Vite, webpack, esbuild…) statically replace `process.env.NODE_ENV`.
 * When nothing replaced it and `process` does not exist (plain browser ESM),
 * the access throws and we treat the environment as non-production.
 */
export function isProductionEnv(): boolean {
  try {
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
}

export function hasWindow(): boolean {
  return typeof window !== "undefined";
}
