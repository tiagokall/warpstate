import * as z from "zod/v4";

/** Version of the snapshot file format produced by this release. */
export const WARP_FORMAT_VERSION = 1 as const;

/** Recommended file extension for snapshot files. */
export const WARP_FILE_EXTENSION = ".warp.json";

/** Adapter names that map to dedicated top-level snapshot fields instead of `stores`. */
export const RESERVED_ADAPTER_NAMES = ["router", "query"] as const;

export interface WarpRouterState {
  /** Full history stack, as hrefs (pathname + search + hash). */
  entries: string[];
  /** Index of the current entry inside `entries`. */
  index: number;
}

export interface WarpSnapshot {
  /** Snapshot format version. */
  warpstate: typeof WARP_FORMAT_VERSION;
  /** Identifies the app (and its state shape) the snapshot was captured from. */
  app?: { name?: string; schemaVersion?: string };
  /** Human-facing metadata. */
  meta?: { name?: string; description?: string; createdAt?: string };
  /** Router history at capture time. */
  router: WarpRouterState;
  /** Store data keyed by adapter name. */
  stores?: Record<string, unknown>;
  /** Data cache, e.g. the output of TanStack Query's `dehydrate()`. */
  query?: unknown;
  /** Web Storage entries restored before the app boots. */
  storage?: { local?: Record<string, string>; session?: Record<string, string> };
}

const stringRecord = z.record(z.string(), z.string());

export const warpSnapshotSchema = z.object({
  warpstate: z.literal(WARP_FORMAT_VERSION),
  app: z
    .object({
      name: z.string().optional(),
      schemaVersion: z.string().optional(),
    })
    .optional(),
  meta: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      createdAt: z.string().optional(),
    })
    .optional(),
  router: z
    .object({
      entries: z.array(z.string().min(1)).min(1, "router.entries must contain at least one href"),
      index: z.number().int().nonnegative(),
    })
    .refine((router) => router.index < router.entries.length, {
      message: "router.index must point to an existing entry",
      path: ["index"],
    }),
  stores: z.record(z.string(), z.unknown()).optional(),
  query: z.unknown().optional(),
  storage: z
    .object({
      local: stringRecord.optional(),
      session: stringRecord.optional(),
    })
    .optional(),
});

// Compile-time guarantee that the hand-written type and the schema agree.
type Inferred = z.infer<typeof warpSnapshotSchema>;
type Assert<T extends true> = T;
export type _SchemaMatchesType = Assert<
  Inferred extends WarpSnapshot ? (WarpSnapshot extends Inferred ? true : false) : false
>;
