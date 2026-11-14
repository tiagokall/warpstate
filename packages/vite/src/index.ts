import type { Plugin } from "vite";

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

  return {
    name: "warpstate",
    enforce: "pre",
    configResolved(config) {
      // Either signal is enough: `mode` is what `vite build` sets, `isProduction`
      // follows NODE_ENV. Stripping too often is safe; shipping the runtime is not.
      const production = config.mode === "production" || config.isProduction;
      strip = config.command === "build" && production && !options.keepInProduction;
    },
    async resolveId(source, importer, resolveOptions) {
      if (!strip || !packages.has(source)) return null;
      const resolved = await this.resolve(`${source}/noop`, importer, { ...resolveOptions, skipSelf: true });
      if (!resolved) {
        this.error(`[warpstate] ${source} has no "/noop" entry; cannot strip it from the production build.`);
      }
      return resolved;
    },
  };
}

export default warpstate;
