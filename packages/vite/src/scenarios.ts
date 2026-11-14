import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { decodeSnapshot, type WarpSnapshot } from "@warpstate/core";

/** Default endpoint the dev server serves the catalog from. */
export const SCENARIOS_ENDPOINT = "/__warpstate/scenarios";

const SNAPSHOT_FILE = /\.warp(\.json)?$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "test-results", "playwright-report", ".turbo", ".cache"]);
const MAX_DEPTH = 8;

export interface ScenarioSummary {
  /** Stable id used to load the scenario (file name without the extension). */
  id: string;
  name?: string;
  description?: string;
  /** Route the app opens on. */
  route?: string;
  /** Number of entries in the history stack. */
  historyLength?: number;
  /** Which stores and caches the snapshot restores. */
  restores?: string[];
  app?: WarpSnapshot["app"];
  /** Path relative to the project root. */
  file: string;
  /** Present when the file is not a valid snapshot. */
  error?: string;
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) await walk(join(dir, entry.name), depth + 1, out);
    } else if (entry.isFile() && SNAPSHOT_FILE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

/** Finds snapshot files under `dirs` (relative to `root`), with the folder each was found in. */
export async function findScenarioFiles(root: string, dirs: string[]): Promise<Array<{ file: string; dir: string }>> {
  const found = new Map<string, string>();
  for (const dir of dirs) {
    const absolute = join(root, dir);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isDirectory()) continue;
    const files: string[] = [];
    await walk(absolute, 0, files);
    for (const file of files) if (!found.has(file)) found.set(file, absolute);
  }
  return [...found].map(([file, dir]) => ({ file, dir })).sort((a, b) => a.file.localeCompare(b.file));
}

function idFor(file: string, dir: string, taken: Set<string>): string {
  const base = basename(file).replace(SNAPSHOT_FILE, "");
  if (!taken.has(base)) return base;
  // Same file name in two folders: use the path from the nearest folder that
  // makes it unique (e.g. "nested/cart").
  const parts = relative(dir, file).replace(SNAPSHOT_FILE, "").split(sep);
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const candidate = parts.slice(i).join("/");
    if (!taken.has(candidate)) return candidate;
  }
  return parts.join("/");
}

export interface ScenarioEntry {
  summary: ScenarioSummary;
  load: () => Promise<WarpSnapshot>;
}

/** Reads and validates every scenario file. Invalid files are listed with an `error`. */
export async function loadCatalog(root: string, dirs: string[]): Promise<Map<string, ScenarioEntry>> {
  const catalog = new Map<string, ScenarioEntry>();
  for (const { file, dir } of await findScenarioFiles(root, dirs)) {
    const id = idFor(file, dir, new Set(catalog.keys()));
    const relativeFile = relative(root, file).split(sep).join("/");
    const load = async () => decodeSnapshot((await readFile(file, "utf8")).trim(), { source: relativeFile });
    let summary: ScenarioSummary;
    try {
      const snapshot = await load();
      summary = {
        id,
        name: snapshot.meta?.name,
        description: snapshot.meta?.description,
        route: snapshot.router.entries[snapshot.router.index],
        historyLength: snapshot.router.entries.length,
        restores: [...Object.keys(snapshot.stores ?? {}), ...(snapshot.query !== undefined ? ["query"] : [])],
        app: snapshot.app,
        file: relativeFile,
      };
    } catch (error) {
      summary = { id, file: relativeFile, error: error instanceof Error ? error.message : String(error) };
    }
    catalog.set(id, { summary, load });
  }
  return catalog;
}
