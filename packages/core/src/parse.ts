import { WarpError } from "./errors";
import { WARP_FORMAT_VERSION, warpSnapshotSchema, type WarpSnapshot } from "./schema";

export interface ParseOptions {
  /** Where the snapshot came from (file path, URL…), used in error messages. */
  source?: string;
}

export type SafeParseResult =
  | { success: true; snapshot: WarpSnapshot }
  | { success: false; error: WarpError };

function describeSource(options?: ParseOptions): string {
  return options?.source ? ` (${options.source})` : "";
}

/**
 * Validates an unknown value as a {@link WarpSnapshot}.
 * Throws a {@link WarpError} with a readable list of problems when invalid.
 */
export function parseSnapshot(input: unknown, options?: ParseOptions): WarpSnapshot {
  const result = safeParseSnapshot(input, options);
  if (!result.success) throw result.error;
  return result.snapshot;
}

export function safeParseSnapshot(input: unknown, options?: ParseOptions): SafeParseResult {
  const where = describeSource(options);

  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch (cause) {
      return {
        success: false,
        error: new WarpError("INVALID_SNAPSHOT", `Snapshot${where} is not valid JSON.`, { cause }),
      };
    }
  }

  if (typeof input === "object" && input !== null && "warpstate" in input) {
    const version = (input as { warpstate: unknown }).warpstate;
    if (typeof version === "number" && version !== WARP_FORMAT_VERSION) {
      return {
        success: false,
        error: new WarpError(
          "UNSUPPORTED_FORMAT",
          `Snapshot${where} uses format version ${version}, but this version of warpstate ` +
            `only reads format version ${WARP_FORMAT_VERSION}. ` +
            (version > WARP_FORMAT_VERSION
              ? "Upgrade the @warpstate/* packages."
              : "Re-capture the snapshot."),
        ),
      };
    }
  }

  const parsed = warpSnapshotSchema.safeParse(input);
  if (parsed.success) return { success: true, snapshot: parsed.data };

  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("\n");
  return {
    success: false,
    error: new WarpError("INVALID_SNAPSHOT", `Invalid warpstate snapshot${where}:\n${issues}`, {
      cause: parsed.error,
    }),
  };
}
