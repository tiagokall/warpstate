# warpstate

**Open your React app directly in the exact state of a test scenario, in one render, with no automated clicking.**

warpstate captures a scenario (route + history stack + stores + data cache) into a small JSON file. Your end-to-end test then boots the app straight into that state:

```ts
test("cart with coupon", async ({ page, warp }) => {
  await warp("e2e/snapshots/cart-with-coupon.warp.json");
  await expect(page.getByTestId("total")).toHaveText("$47.7");
});
```

It is plug and play with **React + TanStack Router**, with adapters for **TanStack Query** and **Zustand**, and it ships helpers for **Playwright**.

---

- [The problem](#the-problem)
- [How it works](#how-it-works)
- [Quickstart](#quickstart)
- [Snapshot format](#snapshot-format)
- [Writing an adapter](#writing-an-adapter)
- [Other test runners](#other-test-runners)
- [AI agents (WebMCP)](#ai-agents-webmcp)
- [Production safety](#production-safety)
- [Obsolete snapshots and migrations](#obsolete-snapshots-and-migrations)
- [API reference](#api-reference)
- [Benchmark](#benchmark)
- [Compatibility](#compatibility)
- [Limitations](#limitations)
- [Roadmap](#roadmap)

## The problem

To test the last step of a checkout, an e2e test usually replays everything before it: open the home page, search, open a product, add to cart, apply a coupon, fill in the shipping form… That makes the test:

- **slow**, because every step waits on rendering and network;
- **brittle**, because a change to the search page breaks the checkout tests;
- **noisy**, because the setup hides what the test is actually about.

Seeding the backend helps with data, but not with client state such as the router's history stack, store contents or cached queries.

warpstate removes the setup. A scenario is captured once (by hand, by a script or by an agent), committed as a `.warp.json` file, and every test opens the app *already in that state*.

## How it works

```
 dev / record                         test run
 ────────────                         ────────
 browse to a scenario                 warp(page, "cart.warp.json")
        │                               │  validates the snapshot (zod)
 Ctrl+Shift+S                           │  page.addInitScript → window.__WARPSTATE__
        │                               │  page.goto(current entry)
 cart.warp.json ───── commit ────────▶  │
                                        ▼
                                      app boots
                                      createWarpRouter():
                                        • restores adapters (stores, query cache)
                                        • createMemoryHistory({ entries, index })
                                        • first render = final state
                                        • resolves __WARPSTATE__.ready
                                        │
                                      warp() resolves → assertions
```

1. **Capture.** In development, navigate to a scenario and press **Ctrl+Shift+S** (or use the overlay button, `useWarp().download()`, `captureWarp(page)` in a script, or the WebMCP tool). You get a `.warp.json` file and a copy on the clipboard.
2. **Inject.** In the test, `warp(page, snapshot)` validates the snapshot and installs it with `page.addInitScript`, so it lands in `window.__WARPSTATE__` before your bundle loads.
3. **Hydrate.** At boot, `createWarpRouter()` sees the snapshot. It restores every registered adapter synchronously, then creates the router on a memory history built from the snapshot's history stack. The very first render is the final state.
4. **Ready.** `window.__WARPSTATE__.ready` resolves when the router renders the initial route. `warp()` waits for it, so assertions start immediately.

Without a snapshot, `createWarpRouter()` behaves exactly like `createRouter()`. In production builds, `@warpstate/vite` replaces the whole runtime with no-ops.

## Quickstart

### 1. Install

```sh
pnpm add @warpstate/react @warpstate/tanstack-router @warpstate/tanstack-query @warpstate/zustand
pnpm add -D @warpstate/playwright @warpstate/vite
```

`zod` (v3.25+ or v4) is a peer dependency of `@warpstate/core`.

Browser packages ship ESM. The Node-side packages (`@warpstate/core`, `@warpstate/playwright`, `@warpstate/vite`) ship both ESM and CommonJS, so Playwright projects without `"type": "module"`, where specs are compiled to `require()`, work as is.

### 2. Strip it from production builds

```diff
 // vite.config.ts
+import { warpstate } from "@warpstate/vite";

 export default defineConfig({
-  plugins: [tanstackRouter(), react()],
+  plugins: [warpstate(), tanstackRouter(), react()],
 });
```

### 3. Swap `createRouter` for `createWarpRouter`

The integration diff (as in the example app's `main.tsx`): **5 lines**.

```diff
-import { createRouter, RouterProvider } from "@tanstack/react-router";
+import { RouterProvider } from "@tanstack/react-router";
+import { createWarpRouter } from "@warpstate/tanstack-router";
+import { queryAdapter } from "@warpstate/tanstack-query";
+import { zustandAdapter } from "@warpstate/zustand";

-const router = createRouter({ routeTree, context: { queryClient } });
+const router = createWarpRouter({ routeTree, context: { queryClient },
+  warp: { adapters: [queryAdapter(queryClient), zustandAdapter("cart", useCart)] } });
```

If you only need route and history restoration, the change is 2 lines (the import and `createRouter` → `createWarpRouter`).

Optional extras:

```diff
+import { WarpProvider } from "@warpstate/react";    // capture shortcut + overlay
+import { registerWarpTools } from "@warpstate/webmcp"; // agent tools
+registerWarpTools();

-<RouterProvider router={router} />
+<WarpProvider overlay><RouterProvider router={router} /></WarpProvider>
```

### 4. Capture a scenario

Run the app in dev, click your way to the scenario and press **Ctrl+Shift+S**. A file such as `cart.warp.json` is downloaded and the JSON is copied to the clipboard. Rename it and save it under `e2e/snapshots/`.

Scenarios can also be recorded by a script (see [`examples/react-tanstack/e2e/record.spec.ts`](examples/react-tanstack/e2e/record.spec.ts)):

```ts
import { captureWarp, saveSnapshot } from "@warpstate/playwright";

const snapshot = await captureWarp(page, { name: "Cart with coupon" });
await saveSnapshot("e2e/snapshots/cart-with-coupon.warp.json", snapshot);
```

### 5. Use it in a test

```ts
import { expect, test } from "@warpstate/playwright"; // Playwright's test + a `warp` fixture

test("checkout review", async ({ page, warp }) => {
  await warp("e2e/snapshots/checkout-review.warp.json");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByTestId("order-id")).toBeVisible();
});
```

Already have your own `test.extend()`? Spread `warpFixtures` into it, or call `warp(page, snapshot)` directly.

> The dev server must serve the app at the snapshot's URL (any SPA fallback does). Run e2e against `vite dev` or a build made with `warpstate({ keepInProduction: true })` and `allowInProduction: true`.

## Snapshot format

```ts
type WarpSnapshot = {
  warpstate: 1;                                       // format version
  app?: { name?: string; schemaVersion?: string };   // detects obsolete snapshots
  meta?: { name?: string; description?: string; createdAt?: string };
  router: { entries: string[]; index: number };      // full history stack (hrefs)
  stores?: Record<string, unknown>;                  // keyed by adapter name
  query?: unknown;                                   // TanStack Query cache
  storage?: { local?: Record<string, string>; session?: Record<string, string> };
};
```

A real one: [`cart-with-coupon.warp.json`](examples/react-tanstack/e2e/snapshots/cart-with-coupon.warp.json).

- Snapshots are validated with zod everywhere they enter: in `warp()` (before the page is touched), in the app at boot, and after `migrate`. Errors list every problem with its path.
- `storage` is restored before the app's own code runs. Nothing is captured from storage unless you opt in with `captureStorage: { local: ["theme"] }`, because storage often holds tokens that must not end up in a committed file.
- `query` uses a compact form of `dehydrate()` that drops fields `hydrate()` does not need.

### Compact form

`.warp.json` is the canonical, committed format: it is readable and diffs well in code review. For transport (clipboard, chat, agents, URLs) there is a compact form: `warp1.` + base64url(deflate-raw(JSON)). It uses the platform's `CompressionStream`, so it adds no dependency.

| Scenario (example app) | Pretty JSON | Compact |
| --- | ---: | ---: |
| cart-with-coupon | 2.8 KB | 0.8 KB |
| checkout-review | 2.4 KB | 0.8 KB |
| search-results | 3.1 KB | 0.7 KB |
| 200-item query cache (very repetitive data) | 64 KB | 2.3 KB |

```ts
import { encodeSnapshot, decodeSnapshot } from "@warpstate/core";
const text = await encodeSnapshot(snapshot); // "warp1.rVTBbt..."
await warp(text);                             // warp(), loadSnapshot() and the agent tools accept any form
```

Save a compact file with `saveSnapshot("x.warp", snapshot)`, or copy one with `<WarpProvider copy="compact">`.

**Bytes are not tokens.** Base64 tokenizes poorly (roughly 2 characters per token vs. ~4 for JSON), so for an LLM the compact form only pays off on large snapshots. For the example's ~1.5 KB scenarios, minified JSON and the compact form cost about the same number of tokens. That is why the agent capture tool defaults to `format: "auto"`, which picks whichever form is cheaper. A binary format such as CBOR or MessagePack was considered and rejected: on this kind of data it saves only about 20–30% over minified JSON (compression saves more), it cannot be reviewed in a diff, and it would need a dependency.

## Writing an adapter

An adapter connects one piece of state:

```ts
interface WarpAdapter<T> {
  name: string;                               // key in snapshot.stores
  capture(): T;                               // must be JSON-serializable
  restore(data: T): void | Promise<void>;     // runs before the first render
}
```

```ts
import { defineAdapter } from "@warpstate/core";

export const themeAdapter = defineAdapter({
  name: "theme",
  capture: () => ({ mode: themeStore.mode }),
  restore: (data) => themeStore.set(data.mode),
});

createWarpRouter({ routeTree, warp: { adapters: [themeAdapter] } });
// or anywhere, before the app renders:
registerAdapter(themeAdapter);
```

Rules of thumb:

- `restore` runs **synchronously at registration** when booting from a snapshot. Register adapters before the first render (the `adapters` option does that). If `restore` returns a promise, `ready` waits for it.
- Capture **data, not instances**. `Map`, `Set`, `Date` and `bigint` are fine anywhere in captured data (including the query cache): they are stored as tagged objects such as `{ "$warp": "Map", "entries": [...] }` and come back as the real type on restore. Functions and class instances do not survive JSON. warpstate warns about each such path when capturing.
- `"router"` and `"query"` are reserved names. They map to `snapshot.router` and `snapshot.query`.
- Store data with no matching adapter produces a warning on `__WARPSTATE__.warnings`. Set `strict: true` to make it an error.
- For a Redux-like store: `capture: () => store.getState()`, and `restore: (s) => store.dispatch({ type: "warp/restore", payload: s })` handled by your root reducer.

## Other test runners

The injection is a plain script, so any runner that can run code before page scripts can use it:

```ts
import { createInitScript, parseSnapshot } from "@warpstate/core";
const script = createInitScript(parseSnapshot(json));

// Puppeteer
await page.evaluateOnNewDocument(script);
// Cypress
cy.visit("/cart", { onBeforeLoad: (win) => win.eval(script) });
// WebDriver BiDi
await bidi.script.addPreloadScript({ functionDeclaration: `() => { ${script} }` });
```

Then wait until `window.__WARPSTATE__.status` is `"ready"` (or `"error"`, with details in `.error`).

## AI agents (WebMCP)

`@warpstate/webmcp` registers [WebMCP](https://webmachinelearning.github.io/webmcp/) tools so a browser agent can work with scenarios:

| Tool | What it does |
| --- | --- |
| `warpstate_status` | Hydration status, current route, registered adapters, warnings. Read-only. |
| `warpstate_list_scenarios` | The project's saved scenarios: id, name, description, route, history length and what each restores. Read-only. Needs `@warpstate/vite` (see below). |
| `warpstate_capture` | Captures the current state. `format: "auto"` (default) returns JSON for small snapshots and the compact string when it is cheaper in tokens. Read-only. |
| `warpstate_load` | `{ scenario: "<id>" }` or `{ snapshot }`: validates it, queues it and reloads the page into it. |

```ts
import { registerWarpTools } from "@warpstate/webmcp";
registerWarpTools(); // no-op in production or when WebMCP is unavailable
```

It uses `document.modelContext` (current spec) and falls back to `navigator.modelContext` (older Chrome builds, the MCP-B polyfill).

### How an agent finds and uses scenarios

An agent never has to know where the snapshot files are, or paste one into the conversation. In dev, the `warpstate()` Vite plugin serves a **read-only catalog** of every `*.warp.json` / `*.warp` file in the project:

```
GET /__warpstate/scenarios        → { scenarios: [{ id, name, description, route, historyLength, restores, file }] }
GET /__warpstate/scenarios/:id    → the snapshot
```

The tools describe the workflow themselves, so a capable agent follows it without extra prompting: `warpstate_status` points to `warpstate_list_scenarios`, and the list result says to call `warpstate_load({ scenario: id })`. A session looks like this:

```text
agent → warpstate_list_scenarios
      ← [{ id: "cart-with-coupon", name: "Cart with coupon",
           description: "2 mugs + 1 tee, WARP10 applied; history: home → products → mug → cart",
           route: "/cart", historyLength: 4, restores: ["cart", "checkout", "query"] }, …]
agent → warpstate_load { scenario: "cart-with-coupon" }   // page reloads into the cart, no clicks
agent → warpstate_status                                  // { status: "ready", location: "/cart" }
```

`meta.name` and `meta.description` are what the agent reads to pick a scenario, so write them for that reader (the capture prompt and `captureWarp(page, { name, description })` both set them).

Safety: the catalog exists only in `vite dev` (never in a build or `vite preview`), it is read-only, and it serves only files found by its scan. Ids are not paths: `../../package.json` is just an unknown id. Scope the scan with `warpstate({ scenarios: ["e2e/snapshots"] })` or turn it off with `scenarios: false`. Unknown ids come back as a tool error listing the known ones. Without the plugin, `warpstate_list_scenarios` says how to add it.

### "Show me": links that open a state

The most useful thing an agent can do with a scenario is often to **put the screen in a state for you**: "show me the checkout review with a long address", "open the cart with an expired coupon". In `vite dev`, any page URL with `?warp=` opens the app in that state, in any browser, with no extension, MCP or WebMCP:

```
http://localhost:5173/?warp=checkout-review      # a scenario id from the catalog
http://localhost:5173/?warp=warp1.…              # an inline compact snapshot
```

The dev server inlines the snapshot into the HTML before the app's scripts run, so the screen renders in that state on the first paint. Reloading the link resets it. The catalog returns each scenario's `link`, and the dev server prints the pattern at startup. A bad id never boots a wrong state: the app starts normally and the console says which ids exist. Like the catalog, links only work in `vite dev`. Rename the parameter with `warpstate({ linkParam: "state" })` or turn it off with `linkParam: false`.

For a state that does not exist yet, a coding agent copies the closest `.warp.json`, edits the stores or route (the snapshot is plain JSON), saves it next to the others and sends you the link. The catalog picks up new files on the next request, and the same file then works as an e2e fixture.

For coding agents that read the repo rather than the browser (Claude Code, Cursor, Codex), a few lines in `AGENTS.md` / `CLAUDE.md` teach the whole workflow:

```md
## App states (warpstate)
- Saved app states live in `e2e/snapshots/*.warp.json`; `meta.description` says what each one is.
- To show me a screen in a given state: with the dev server running, send me `http://localhost:5173/?warp=<id>`.
  If no scenario matches, copy the closest file, edit `stores` / `query` / `router` (plain JSON),
  save it as `e2e/snapshots/<new-id>.warp.json` with a clear `meta.description`, then send the link.
- In the browser (dev server + WebMCP): `warpstate_list_scenarios`, then `warpstate_load { scenario: "<id>" }`.
- In Playwright tests: `await warp("e2e/snapshots/<id>.warp.json")` from `@warpstate/playwright`.
- To record a state from the running app, call `warpstate_capture` or press Ctrl+Shift+S.
```

**Validated against Chrome's real WebMCP implementation** (Chrome 157 stable and Chromium 159). A [Playwright suite](examples/react-tanstack/e2e/webmcp/webmcp.spec.ts) launches Chrome with WebMCP enabled and plays the browser agent through the DevTools Protocol `WebMCP` domain (`toolsAdded`, `invokeTool`, `toolResponded`). It checks that the tools register with their schemas and annotations, that status and capture return results, that an agent can list the project's scenarios and open one by id, and that `warpstate_load` reloads the page into a scenario whose new document registers fresh tools. An invalid snapshot comes back as a tool error. It runs in CI on every push.

To try it yourself, enable `chrome://flags/#enable-webmcp-testing` (or launch Chromium with `--enable-features=WebMCP`). Then run the example and check `await document.modelContext.getTools()` in the console. [`e2e/webmcp/agent.ts`](examples/react-tanstack/e2e/webmcp/agent.ts) is a ~100-line CDP client you can reuse to drive any page's WebMCP tools from Playwright. Agents that drive the page another way, such as Playwright MCP or DevTools, can use the same operations on the global:

```js
await window.__WARPSTATE__.capture({ name: "bug repro" }); // snapshot object
await window.__WARPSTATE__.load("warp1.…");                 // reloads into it
window.__WARPSTATE__.status;                                // "idle" | "pending" | "hydrating" | "ready" | "error"
```

A typical loop: an agent reproduces a bug, captures it, and hands the compact string to a developer or to a test.

### Connecting an MCP agent (Claude Code, Claude Desktop, Cursor…)

The official [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) server can list and call a page's WebMCP tools (`list_webmcp_tools`, `execute_webmcp_tool`), so any MCP client reaches warpstate's tools without a custom bridge:

```sh
claude mcp add chrome-devtools --scope project -- npx -y chrome-devtools-mcp@latest \
  --categoryExperimentalWebmcp --chromeArg=--enable-features=WebMCP --isolated
```

Then ask the agent to open your dev server and use the `warpstate_*` tools. Requirements: Chrome 150+ (WebMCP behind `--enable-features=WebMCP`) and a dev build of your app. Chrome DevTools MCP leaves tools marked with the WebMCP `debugging` annotation out of `list_webmcp_tools`, so warpstate does not set that mark by default. Pass `registerWarpTools({ debugging: true })` if you want the tools listed only as developer tools (`--categoryExperimentalThirdParty`).

Every Chrome DevTools MCP tool takes a `pageId` (from `list_pages`), and `execute_webmcp_tool` takes the tool input as a JSON string: `{ "pageId": 1, "toolName": "warpstate_load", "input": "{\"scenario\":\"cart-with-coupon\"}" }`.

> The chain *page → Chrome WebMCP → CDP `WebMCP.invokeTool`* is covered by this repo's e2e tests in CI. The full *MCP client → Chrome DevTools MCP 1.13 → Chrome 157 → warpstate* chain was validated by hand against a local dev server. The tools were listed with `debugging: false`, and `status`, `list_scenarios` and `load { scenario }` all ran, opening the cart at `/cart` with `status: "ready"`. That hop is not automated in CI yet.

## Production safety

- `@warpstate/vite` resolves every `@warpstate/*` runtime package to a no-op entry in production builds. `createWarpRouter` becomes a call to `createRouter`, `WarpProvider` renders its children, and adapters become inert objects. The example's CI checks that the production bundle contains none of the runtime ([`check-prod-bundle.mjs`](examples/react-tanstack/scripts/check-prod-bundle.mjs)). In the example this removes 34 KB (11 KB gzipped).
- Independently of the plugin, the runtime refuses to hydrate when `process.env.NODE_ENV === "production"`, unless the **app code** opts in with `warp: { allowInProduction: true }`. Injected data cannot opt itself in.
- Capture never reads Web Storage unless configured to.

## Obsolete snapshots and migrations

Declare the shape version of your state:

```ts
createWarpRouter({
  routeTree,
  warp: {
    app: { name: "warp-shop", schemaVersion: "2" },
    migrate: (snapshot, { from, to }) => {
      if (from === "1") return { ...snapshot, stores: { ...snapshot.stores, cart: upgradeCart(snapshot.stores?.cart) } };
      return null; // reject as obsolete
    },
  },
});
```

Captures record `app`. At boot, a snapshot with a different `schemaVersion` goes through `migrate`. With no `migrate`, or when it returns `null`, the snapshot is rejected, the app boots normally, and `warp()` fails with:

```
The app rejected the snapshot [OBSOLETE_SNAPSHOT]: Snapshot "Cart with coupon" has schemaVersion "1"
but the app expects "2". Re-capture it or add a `migrate` hook.
```

Snapshots from another `app.name` are rejected with `APP_MISMATCH`.

## API reference

| Package | Exports |
| --- | --- |
| `@warpstate/core` | `encodeValue` / `decodeValue` (Map, Set, Date, bigint), `WarpSnapshot`, `warpSnapshotSchema`, `parseSnapshot`, `safeParseSnapshot`, `WarpAdapter`, `defineAdapter`, `registerAdapter`, `configureWarp`, `initWarp`, `getActiveSnapshot`, `isWarping`, `captureSnapshot`, `loadSnapshot`, `createInitScript`, `encodeSnapshot`, `decodeSnapshot`, `serializeSnapshot`, `downloadSnapshot`, `copySnapshot`, `WarpError` |
| `@warpstate/tanstack-router` | `createWarpRouter(options & { warp })`, `routerAdapter`, `createSnapshotHistory`, `HistoryTracker` |
| `@warpstate/react` | `<WarpProvider shortcut download copy promptForName overlay onCapture>`, `useWarp()` → `{ status, isWarping, snapshot, error, capture, download, copy, load }` |
| `@warpstate/tanstack-query` | `queryAdapter(queryClient, { capture: "all" \| "active", compact, freshen, freeze, dehydrate, hydrate })` |
| `@warpstate/zustand` | `zustandAdapter(name, store, { partialize, merge })` |
| `@warpstate/playwright` | `test` / `expect` with a `warp` fixture, `warpFixtures`, `warp(page, input, { url, timeout, waitForReady, query: "restore" \| "refetch" })`, `waitForWarp`, `captureWarp`, `saveSnapshot`, `loadSnapshotInput`, `warpLocation` |
| `@warpstate/webmcp` | `registerWarpTools({ signal, prefix, allowLoad, debugging, scenariosEndpoint })`, `getModelContext`, `estimateTokens` |
| `@warpstate/vite` | `warpstate({ keepInProduction, extraPackages, scenarios, linkParam })`, `loadCatalog`, `SCENARIOS_ENDPOINT` |

`createWarpRouter`'s `warp` option accepts `adapters`, `app`, `migrate`, `allowInProduction`, `strict`, `captureStorage` and `mirrorUrl`.

- **Address bar.** A warped app runs on a memory history; by default (`mirrorUrl: true`) its current route is mirrored into the address bar, so copying the URL or opening a new tab lands on the same route (with live data). `?warp=` links keep their parameter, so reloading reopens the scenario.
- **Live data instead of the saved copy.** `warp(page, snapshot, { query: "refetch" })` (and `warpstate_load { query: "refetch" }`) restores route, history and stores but lets the app fetch from the server. Use it for tests that check server behaviour.
- **Smaller snapshots.** Apps that prefetch heavily (e.g. `defaultPreload: "intent"`) accumulate a large query cache. `queryAdapter(client, { capture: "active" })` captures only what the current screen uses; other screens fetch when visited.

### TanStack Query notes

Restored queries are stamped as fetched "now" (`freshen`). While the app is warping, `freeze` sets the client's default `staleTime` to `Infinity` and turns off focus and reconnect refetches and retries. Restored data therefore stays authoritative, and a scenario renders with zero requests. Per-query options still win, and invalidations (after a mutation, for example) still refetch. Turn either option off to get the original behavior.

## Benchmark

`pnpm --filter example-react-tanstack bench` reaches each example scenario two ways: by clicking through the UI, and with `warp()`. Each way ends with the same assertion. Full method and raw data: [`bench/RESULTS.md`](examples/react-tanstack/bench/RESULTS.md).

**CI time** (median of 7, Chromium headless, Vite dev server):

| Simulated API latency | Click-through (3 scenarios) | warp() | Saved |
| --- | ---: | ---: | ---: |
| 0 ms | 4.75 s | 3.22 s | 32% |
| 300 ms | 7.12 s | 3.64 s | 49% |

The cost of `warp()` is flat (≈1 s, mostly app boot). The cost of clicking through grows with every step × request latency. Here the flows are only 4–11 actions long, so real suites with longer setups gain more.

**Agent cost** to bring a browser agent into a scenario, modeling a Playwright-MCP-style agent that receives an ARIA snapshot after every action:

| Scenario | Click-through | warpstate_load |
| --- | ---: | ---: |
| cart-with-coupon (11 actions) | 11 calls · ≈1,890 tokens | 3 calls · ≈720 tokens |
| checkout-review (11 actions) | 11 calls · ≈1,750 tokens | 3 calls · ≈650 tokens |
| search-results (4 actions) | 4 calls · ≈960 tokens | 3 calls · ≈710 tokens |

Characters are measured. Tokens are an estimate (4 characters per token for text, 2 for base64), and the reasoning an agent does between steps is not counted.

## Compatibility

See [COMPATIBILITY.md](COMPATIBILITY.md) for the tested library versions. The matrix lives in [`compat/matrix.json`](compat/matrix.json); add a version and run `pnpm compat` to extend it.

## Limitations

- **Non-serializable state** (functions, class instances, DOM nodes, `File`s, open promises) cannot be captured. Keep it out of stores, or rebuild it in your adapter's `restore`.
- **Live connections** (websockets, SSE, WebRTC) are not part of the snapshot. They reconnect as the app normally would, and the messages they deliver can change state after `ready`. Mock them in tests (`page.routeWebSocket`).
- **Timers and animations** in flight are not captured. A countdown restarts and a toast that was visible is gone. Freeze time with `page.clock` if it matters.
- **Server state** is not touched. The query cache makes the UI render without fetching, but mutations still reach your API, so mock it (`page.route`) or seed it as usual.
- **Memory history while warping**: the address bar mirrors the current route (`mirrorUrl`), but the browser's own history is not rebuilt. Use the app's back button instead of `page.goBack()`; `warpLocation(page)` and `page.url()` both give the current route.
- **Module-level side effects** that read state before `createWarpRouter` runs see the pre-restore state. Snapshot `storage` is the exception: it is written before any app code.
- **Uncontrolled inputs** keep only what was saved in a store. Text typed into an uncontrolled field and never committed to state is not captured.
- **Snapshots go stale** as the app evolves. Use `app.schemaVersion` + `migrate`, and re-record (`pnpm record` in the example) when needed.

## Roadmap

- Redux / Redux Toolkit adapter
- Vue: Pinia adapter and Vue Router integration
- Cypress commands (`cy.warp()`)
- Validating store data against the store's type (zod schemas per adapter, generated from TypeScript types)
- CLI to list, validate, diff, migrate and convert snapshots (`warpstate check e2e/snapshots`)
- Snapshot editor in the dev overlay
- More routers (React Router) and data libraries (SWR, Apollo)

## Repository layout

```
packages/
  core              schema, validation, registry, hydration lifecycle, encoding
  tanstack-router   createWarpRouter
  react             WarpProvider, useWarp, capture shortcut
  tanstack-query    queryAdapter
  zustand           zustandAdapter
  playwright        warp(), fixture, captureWarp
  webmcp            agent tools
  vite              production stripping
examples/
  react-tanstack    Warp Shop: Vite + TanStack Router + Query + Zustand, with e2e tests
```

```sh
pnpm install
pnpm build && pnpm test      # unit tests
pnpm e2e                     # Playwright e2e for the example
pnpm --filter example-react-tanstack dev
```

## License

[MIT](LICENSE)
