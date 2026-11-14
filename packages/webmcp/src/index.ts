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
 * - `warpstate_capture`: the current state as a snapshot (compact by default).
 * - `warpstate_load`: boots the app from a snapshot (reloads the page).
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

  const tools: WebMcpTool[] = [
    {
      name: `${prefix}status`,
      title: "warpstate status",
      description:
        "Reports whether this app was booted from a warpstate snapshot, its hydration status, " +
        "the current route and which state adapters (router, query cache, stores) are registered.",
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

  if (options.allowLoad !== false) {
    tools.push({
      name: `${prefix}load`,
      title: "Load warpstate snapshot",
      description:
        "Reloads the app directly into the state described by a warpstate snapshot (a 'warp1.' string, " +
        "a JSON string or a snapshot object). Unsaved state in the page is lost. " +
        "Call the status tool afterwards to confirm it reached 'ready'.",
      inputSchema: {
        type: "object",
        properties: {
          snapshot: {
            description: "A compact 'warp1.' string, a JSON string or a snapshot object.",
            anyOf: [{ type: "string" }, { type: "object" }],
          },
        },
        required: ["snapshot"],
      },
      annotations: { consequentialHint: true, debugging },
      execute: async (input) => {
        try {
          const snapshot = await decodeSnapshot(input.snapshot, { source: "warpstate_load" });
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
