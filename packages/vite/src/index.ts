import { createInitScript, decodeSnapshot, isEncodedSnapshot } from "@warpstate/core";
import type { Plugin } from "vite";
import { SCENARIOS_ENDPOINT, loadCatalog } from "./scenarios";

export { SCENARIOS_ENDPOINT, findScenarioFiles, loadCatalog, type ScenarioSummary } from "./scenarios";

/** Browser-side packages that ship a `/noop` entry. */
export const RUNTIME_PACKAGES = [
  "@warpstate/core",
  "@warpstate/react",
  "@warpstate/tanstack-router",
  "@warpstate/tanstack-query",
  "@warpstate/zustand",
  "@warpstate/webmcp",
] as const;

export interface WarpstatePluginOptions {
  /**
   * Keep the real runtime in production builds, e.g. to run e2e tests against a
   * staging build. The app must also opt in with `allowInProduction: true`.
   * Default: `false`.
   */
  keepInProduction?: boolean;
  /** Extra package names that expose a `/noop` entry (e.g. your own adapters). */
  extraPackages?: string[];
  /**
   * Folders (relative to the Vite root) searched for `*.warp.json` / `*.warp`
   * scenario files. In `vite dev` they are served as a read-only catalog at
   * `/__warpstate/scenarios`, which agents use to discover and load scenarios
   * by id. `false` disables the catalog. Default: the whole project root,
   * skipping node_modules, dist and dot-folders, plus `test-results` (where
   * failing Playwright tests save their snapshots).
   */
  scenarios?: string[] | false;
  /**
   * Query parameter that opens the app in a scenario during `vite dev`:
   * `http://localhost:5173/?warp=checkout-review` (a catalog id) or
   * `?warp=warp1.…` (a compact snapshot). The dev server inlines the snapshot
   * into the HTML before the app boots, so any browser can open the link.
   * `false` disables it. Default: `"warp"`.
   */
  linkParam?: string | false;
}

type ResolveIdHandler = Extract<NonNullable<Plugin["resolveId"]>, (...args: never[]) => unknown>;

const escapeRegExp =(value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Inline script that reports a bad `?warp=` link in the console and in `__WARPSTATE__`. */
function linkErrorScript(message: string): string {
  const payload = JSON.stringify({ code: "INVALID_LINK", message }).replace(
    /[<\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `(function (e) {
  var g = window.__WARPSTATE__ || {};
  g.status = "error"; g.error = e; g.warnings = [];
  window.__WARPSTATE__ = g;
  console.error("[warpstate] " + e.message);
})(${payload});`;
}

/**
 * Replaces the warpstate runtime with no-op modules in production builds, so
 * hydration code, zod and the capture UI never reach production bundles.
 * Your app keeps importing `@warpstate/*` normally; `createWarpRouter` becomes a
 * thin call to `createRouter`, `WarpProvider` renders its children, adapters
 * become inert objects.
 */
export function warpstate(options: WarpstatePluginOptions = {}): Plugin {
  const packages = new Set<string>([...RUNTIME_PACKAGES, ...(options.extraPackages ?? [])]);
  let strip = false;
  let serving = false;
  let root = ".";
  // Default: the whole project plus Playwright's output folder, so snapshots saved
  // by failing tests (@warpstate/playwright) can be opened with ?warp=.
  const dirs = options.scenarios === false ? [] : (options.scenarios ?? [".", "test-results"]);
  const linkParam = options.linkParam === false ? null : (options.linkParam ?? "warp");
  const linkFor = (id: string) => (linkParam ? `/?${linkParam}=${encodeURIComponent(id)}` : undefined);

  const handler: ResolveIdHandler = async function (source, importer, resolveOptions) {
    if (!strip || !packages.has(source)) return null;
    const resolved = await this.resolve(`${source}/noop`, importer, { ...resolveOptions, skipSelf: true });
    if (!resolved) {
      this.error(`[warpstate] ${source} has no "/noop" entry; cannot strip it from the production build.`);
    }
    return resolved;
  };
  // Hook filter (Vite 6.3+, Rolldown): the hook only runs for the runtime
  // packages instead of every import in the app. Older Vite ignores `filter`;
  // kept out of the plugin literal so Vite 5 typings (no `filter`) accept it.
  const resolveId = { filter: { id: new RegExp(`^(${[...packages].map(escapeRegExp).join("|")})$`) }, handler };

  return {
    name: "warpstate",
    enforce: "pre",
    configResolved(config) {
      // Either signal is enough: `mode` is what `vite build` sets, `isProduction`
      // follows NODE_ENV. Stripping too often is safe; shipping the runtime is not.
      const production = config.mode === "production" || config.isProduction;
      strip = config.command === "build" && production && !options.keepInProduction;
      serving = config.command === "serve";
      root = config.root;
    },
    async transformIndexHtml(html, ctx) {
      // Dev server only: `vite preview` and builds never see this.
      if (!serving || !linkParam || !ctx.server) return;
      const query = (ctx.originalUrl ?? ctx.path).split("?")[1];
      const value = query ? new URLSearchParams(query).get(linkParam) : null;
      if (!value) return;
      let script: string;
      try {
        let input: unknown = value;
        if (!value.trimStart().startsWith("{") && !isEncodedSnapshot(value)) {
          const catalog = await loadCatalog(root, dirs);
          const entry = catalog.get(value);
          if (!entry) {
            const known = [...catalog.keys()].join(", ") || "none";
            throw new Error(`Unknown scenario "${value}" in ?${linkParam}=. Known ids: ${known}.`);
          }
          input = await entry.load();
        }
        const keep = JSON.stringify(`${linkParam}=${encodeURIComponent(value)}`).replace(/</g, "\\u003c");
        script =
          createInitScript(await decodeSnapshot(input, { source: `?${linkParam}=` })) +
          `if (window.__WARPSTATE__) window.__WARPSTATE__.keepParams = ${keep};\n`;
      } catch (error) {
        script = linkErrorScript(error instanceof Error ? error.message : String(error));
      }
      // Classic inline script in <head>: runs before the app's module scripts.
      return { html, tags: [{ tag: "script", children: script, injectTo: "head-prepend" }] };
    },
    configureServer(server) {
      if (options.scenarios === false) return;
      if (linkParam) {
        server.httpServer?.once("listening", () => {
          setTimeout(() => {
            const url = server.resolvedUrls?.local[0];
            if (url) server.config.logger.info(`  ➜  warpstate: open a scenario with ${url.replace(/\/$/, "")}/?${linkParam}=<id>`);
          }, 0);
        });
      }
      server.middlewares.use(SCENARIOS_ENDPOINT, (req, res, next) => {
        if (req.method !== "GET") return next();
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.setHeader("cache-control", "no-store");
          res.end(JSON.stringify(body));
        };
        void (async () => {
          // Re-read on every request so new or edited scenarios show up immediately.
          const catalog = await loadCatalog(server.config.root, dirs);
          const id = decodeURIComponent((req.url ?? "/").split("?")[0]!.replace(/^\/+|\/+$/g, ""));
          if (!id) {
            return send(200, {
              scenarios: [...catalog.values()].map((entry) => ({ ...entry.summary, link: linkFor(entry.summary.id) })),
            });
          }
          // Only ids from the scan are served, never arbitrary paths.
          const entry = catalog.get(id);
          if (!entry) return send(404, { error: `Unknown scenario "${id}".`, available: [...catalog.keys()] });
          try {
            send(200, await entry.load());
          } catch (error) {
            send(422, { error: error instanceof Error ? error.message : String(error) });
          }
        })().catch(next);
      });
    },
    resolveId,
  };
}

export default warpstate;
