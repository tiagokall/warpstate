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

Save a compact file with `saveSnapshot("x.warp", snapshot)`, or copy one with `<WarpProvider copy="compact">`. A binary format such as CBOR or MessagePack was considered and rejected: on this kind of data it saves only about 20–30% over minified JSON (compression saves more), it cannot be reviewed in a diff, and it would need a dependency.

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
- Capture **data, not instances**: functions, Maps, Sets, Dates and class instances do not survive JSON. warpstate warns about each such path when capturing.
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
| `warpstate_capture` | Captures the current state (compact by default, `format: "json"` for the object). Read-only. |
| `warpstate_load` | Validates a snapshot, queues it and reloads the page into it. |

```ts
import { registerWarpTools } from "@warpstate/webmcp";
registerWarpTools(); // no-op in production or when WebMCP is unavailable
```

It uses `document.modelContext` (current spec) and falls back to `navigator.modelContext` (older Chrome builds, the MCP-B polyfill). Agents that drive the page another way, such as Playwright MCP or DevTools, can use the same operations on the global:

```js
await window.__WARPSTATE__.capture({ name: "bug repro" }); // snapshot object
await window.__WARPSTATE__.load("warp1.…");                 // reloads into it
window.__WARPSTATE__.status;                                // "idle" | "pending" | "hydrating" | "ready" | "error"
```

A typical loop: an agent reproduces a bug, captures it, and hands the compact string to a developer or to a test.

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
| `@warpstate/core` | `WarpSnapshot`, `warpSnapshotSchema`, `parseSnapshot`, `safeParseSnapshot`, `WarpAdapter`, `defineAdapter`, `registerAdapter`, `configureWarp`, `initWarp`, `getActiveSnapshot`, `isWarping`, `captureSnapshot`, `loadSnapshot`, `createInitScript`, `encodeSnapshot`, `decodeSnapshot`, `serializeSnapshot`, `downloadSnapshot`, `copySnapshot`, `WarpError` |
| `@warpstate/tanstack-router` | `createWarpRouter(options & { warp })`, `routerAdapter`, `createSnapshotHistory`, `HistoryTracker` |
| `@warpstate/react` | `<WarpProvider shortcut download copy promptForName overlay onCapture>`, `useWarp()` → `{ status, isWarping, snapshot, error, capture, download, copy, load }` |
| `@warpstate/tanstack-query` | `queryAdapter(queryClient, { compact, freshen, freeze, dehydrate, hydrate })` |
| `@warpstate/zustand` | `zustandAdapter(name, store, { partialize, merge })` |
| `@warpstate/playwright` | `test` / `expect` with a `warp` fixture, `warpFixtures`, `warp(page, input, { url, timeout, waitForReady })`, `waitForWarp`, `captureWarp`, `saveSnapshot`, `loadSnapshotInput`, `warpLocation` |
| `@warpstate/webmcp` | `registerWarpTools({ signal, prefix, allowLoad })`, `getModelContext` |
| `@warpstate/vite` | `warpstate({ keepInProduction, extraPackages })` |

`createWarpRouter`'s `warp` option accepts `adapters`, `app`, `migrate`, `allowInProduction`, `strict` and `captureStorage`.

### TanStack Query notes

Restored queries are stamped as fetched "now" (`freshen`). While the app is warping, `freeze` sets the client's default `staleTime` to `Infinity` and turns off focus and reconnect refetches and retries. Restored data therefore stays authoritative, and a scenario renders with zero requests. Per-query options still win, and invalidations (after a mutation, for example) still refetch. Turn either option off to get the original behavior.

## Limitations

- **Non-serializable state** (functions, class instances, Maps/Sets, DOM nodes, `File`s, open promises) cannot be captured. Keep it out of stores, or rebuild it in your adapter's `restore`.
- **Live connections** (websockets, SSE, WebRTC) are not part of the snapshot. They reconnect as the app normally would, and the messages they deliver can change state after `ready`. Mock them in tests (`page.routeWebSocket`).
- **Timers and animations** in flight are not captured. A countdown restarts and a toast that was visible is gone. Freeze time with `page.clock` if it matters.
- **Server state** is not touched. The query cache makes the UI render without fetching, but mutations still reach your API, so mock it (`page.route`) or seed it as usual.
- **Memory history while warping**: the browser URL is set once to the current entry and does not follow later in-app navigation. Use `warpLocation(page)` instead of `page.url()`, and the app's own back button instead of `page.goBack()`.
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
