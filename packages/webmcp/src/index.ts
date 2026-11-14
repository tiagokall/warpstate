import {
  encodeSnapshot,
  getActiveSnapshot,
  getAdapters,
  getWarpGlobal,
  initWarp,
  isProductionEnv,
  loadSnapshot,
  captureSnapshotWithReport,
  decodeSnapshot,
} from "@warpstate/core";

/** Minimal structural view of the WebMCP `ModelContext` interface. */
export interface ModelContextLike {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<void> | void;
}

export interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    consequentialHint?: boolean;
    untrustedContentHint?: boolean;
    debugging?: boolean;
  };
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

export interface WarpToolsOptions {
  /** Unregisters every tool when aborted. */
  signal?: AbortSignal;
  /** Tool name prefix. Default: `"warpstate_"`. */
  prefix?: string;
  /** Register the tool that loads a snapshot (reloads the page). Default: `true`. */
  allowLoad?: boolean;
  /** Override the detected `ModelContext` (tests, polyfills). */
  modelContext?: ModelContextLike;
  /**
   * Mark the tools with the WebMCP `debugging` annotation. Agents treat those as
   * developer-only: Chrome DevTools MCP, for example, leaves them out of
   * `list_webmcp_tools` and only lists them as third-party developer tools.
   * Default: `false`, so agents see the tools (they only exist in dev builds).
   */
  debugging?: boolean;
  /**
   * Where the dev server serves the scenario catalog (`@warpstate/vite` serves
   * it at `/__warpstate/scenarios`). `false` drops the list tool and loading by id.
   */
  scenariosEndpoint?: string | false;
}

/** Default catalog endpoint, kept in sync with `@warpstate/vite`. */
export const DEFAULT_SCENARIOS_ENDPOINT = "/__warpstate/scenarios";

const NO_CATALOG_HINT =
  "No scenario catalog on this server. Add the warpstate() plugin from @warpstate/vite to vite.config " +
  "(it serves *.warp.json files from the project in dev), or pass a snapshot directly.";

async function fetchCatalog(url: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  return { status: response.status, body: isJson ? ((await response.json()) as Record<string, unknown>) : null };
}

/** `document.modelContext` (current spec) or `navigator.modelContext` (older builds, MCP-B polyfill). */
export function getModelContext(): ModelContextLike | undefined {
  const fromDocument =
    typeof document !== "undefined" ? (document as unknown as { modelContext?: ModelContextLike }).modelContext : undefined;
  const fromNavigator =
    typeof navigator !== "undefined" ? (navigator as unknown as { modelContext?: ModelContextLike }).modelContext : undefined;
  return fromDocument ?? fromNavigator;
}

/**
 * Rough LLM token estimate: ~4 characters per token for JSON/text, ~2 for base64
 * (random-looking strings split into many short tokens).
 */
export function estimateTokens(text: string, kind: "text" | "base64"): number {
  return Math.ceil(text.length / (kind === "text" ? 4 : 2));
}

/** Result shape understood by WebMCP (any JSON) and MCP clients (`content` blocks). */
function result(data: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
  };
}

function errorResult(error: unknown) {
  return result({ error: error instanceof Error ? error.message : String(error) }, true);
}

/**
 * Registers WebMCP tools so an AI agent working in the browser can inspect,
 * capture and load warpstate snapshots:
 *
 * - `warpstate_status`: hydration status, current route, registered adapters.
 * - `warpstate_list_scenarios`: the project's saved scenarios (needs `@warpstate/vite`).
 * - `warpstate_capture`: the current state as a snapshot.
 * - `warpstate_load`: boots the app from a scenario id or a snapshot (reloads the page).
 *
 * Does nothing in production builds or when the browser has no WebMCP support.
 * Returns a function that unregisters the tools.
 */
export function registerWarpTools(options: WarpToolsOptions = {}): () => void {
  const controller = new AbortController();
  const unregister = () => controller.abort();
  if (isProductionEnv()) return unregister;

  const modelContext = options.modelContext ?? getModelContext();
  if (!modelContext) return unregister;

  options.signal?.addEventListener("abort", unregister, { once: true });
  initWarp();
  const prefix = options.prefix ?? "warpstate_";
  const debugging = options.debugging ?? false;
  const endpoint =
    options.scenariosEndpoint === false ? null : (options.scenariosEndpoint ?? DEFAULT_SCENARIOS_ENDPOINT).replace(/\/+$/, "");

  const tools: WebMcpTool[] = [
    {
      name: `${prefix}status`,
      title: "warpstate status",
      description:
        "Reports whether this app was booted from a warpstate snapshot, its hydration status, " +
        "the current route and which state adapters (router, query cache, stores) are registered." +
        (endpoint ? ` To jump to a known app state, call ${prefix}list_scenarios and then ${prefix}load with a scenario id.` : ""),
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, debugging },
      execute: async () => {
        const global = getWarpGlobal();
        const active = getActiveSnapshot();
        return result({
          status: global?.status ?? "idle",
          error: global?.error ?? null,
          warnings: global?.warnings ?? [],
          location: global?.location?.() ?? window.location.pathname + window.location.search + window.location.hash,
          bootedFromSnapshot: active ? (active.meta?.name ?? true) : false,
          adapters: [...getAdapters().keys()],
        });
      },
    },
    {
      name: `${prefix}capture`,
      title: "Capture warpstate snapshot",
      description:
        "Captures the app's current state (route history, data cache, stores) as a warpstate snapshot " +
        "that can later be loaded with the load tool or used in an e2e test. " +
        "`auto` (default) returns whichever form costs fewer tokens: the readable JSON object for small " +
        "snapshots, a compressed 'warp1.' string for large ones. `json` and `compact` force a form.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Scenario name, e.g. 'cart with expired coupon'." },
          description: { type: "string" },
          format: { type: "string", enum: ["auto", "json", "compact"], default: "auto" },
        },
      },
      annotations: { readOnlyHint: true, debugging },
      execute: async (input) => {
        try {
          const meta = {
            ...(typeof input.name === "string" ? { name: input.name } : {}),
            ...(typeof input.description === "string" ? { description: input.description } : {}),
          };
          const { snapshot, warnings } = captureSnapshotWithReport(meta);
          const json = JSON.stringify(snapshot);
          const asJson = () => result({ format: "json", snapshot, bytes: json.length, warnings });
          if (input.format === "json") return asJson();
          const encoded = await encodeSnapshot(snapshot);
          // Base64 tokenizes far worse than JSON, so compression only pays off for large snapshots.
          if (input.format !== "compact" && estimateTokens(json, "text") <= estimateTokens(encoded, "base64")) {
            return asJson();
          }
          return result({ format: "compact", snapshot: encoded, bytes: encoded.length, jsonBytes: json.length, warnings });
        } catch (error) {
          return errorResult(error);
        }
      },
    },
  ];

  if (endpoint) {
    tools.splice(1, 0, {
      name: `${prefix}list_scenarios`,
      title: "List warpstate scenarios",
      description:
        "Lists the saved app states (scenarios) checked into this project: id, name, description, the route " +
        `it opens on and what it restores. Use it before testing or debugging a screen: ${prefix}load with ` +
        "{ scenario: id } opens the app directly in that state, instead of clicking through the UI to get there.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, debugging },
      execute: async () => {
        try {
          const { status, body } = await fetchCatalog(endpoint);
          if (status === 404 || !body || !Array.isArray(body.scenarios)) return result({ error: NO_CATALOG_HINT }, true);
          return result({
            scenarios: body.scenarios,
            next:
              `Call ${prefix}load with { "scenario": "<id>" } to open one here. To show one to the user in ` +
              "their own browser, give them this origin + the scenario's `link` (e.g. http://localhost:5173/?warp=<id>).",
          });
        } catch (error) {
          return errorResult(error);
        }
      },
    });
  }

  if (options.allowLoad !== false) {
    tools.push({
      name: `${prefix}load`,
      title: "Load warpstate snapshot",
      description:
        "Reloads the app directly into a saved state. Pass either `scenario` (an id from " +
        `${prefix}list_scenarios) or \`snapshot\` (one returned by ${prefix}capture: a 'warp1.' string, ` +
        "a JSON string or a snapshot object). Unsaved state in the page is lost. " +
        `Call ${prefix}status afterwards to confirm it reached 'ready'.`,
      inputSchema: {
        type: "object",
        properties: {
          ...(endpoint ? { scenario: { type: "string", description: "Scenario id from the list tool." } } : {}),
          snapshot: {
            description: "A compact 'warp1.' string, a JSON string or a snapshot object.",
            anyOf: [{ type: "string" }, { type: "object" }],
          },
        },
        // No top-level oneOf: several model APIs reject it in tool schemas. Checked in execute().
        ...(endpoint ? {} : { required: ["snapshot"] }),
      },
      annotations: { consequentialHint: true, debugging },
      execute: async (input) => {
        try {
          let source: unknown = input.snapshot;
          if (typeof input.scenario === "string") {
            if (!endpoint) throw new Error("Loading by scenario id is disabled (scenariosEndpoint: false).");
            const { status, body } = await fetchCatalog(`${endpoint}/${encodeURIComponent(input.scenario)}`);
            if (status !== 200 || !body) {
              const known = body && Array.isArray(body.available) ? ` Known ids: ${body.available.join(", ")}.` : "";
              throw new Error(body?.error ? `${String(body.error)}${known}` : NO_CATALOG_HINT);
            }
            source = body;
          } else if (source === undefined) {
            throw new Error(`Pass { scenario: "<id>" } (see ${prefix}list_scenarios) or { snapshot }.`);
          }
          const snapshot = await decodeSnapshot(source, { source: typeof input.scenario === "string" ? `scenario "${input.scenario}"` : "warpstate_load" });
          await loadSnapshot(snapshot, { reload: false });
          // Let the tool result reach the agent before the page goes away.
          setTimeout(() => window.location.reload(), 50);
          return result({
            loading: snapshot.meta?.name ?? snapshot.router.entries[snapshot.router.index],
            reloading: true,
          });
        } catch (error) {
          return errorResult(error);
        }
      },
    });
  }

  for (const tool of tools) {
    try {
      // Per spec, aborting the signal unregisters the tool and rejects this promise.
      void Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal })).catch(() => undefined);
    } catch (error) {
      console.warn(`[warpstate] Could not register WebMCP tool "${tool.name}":`, error);
    }
  }
  return unregister;
}
