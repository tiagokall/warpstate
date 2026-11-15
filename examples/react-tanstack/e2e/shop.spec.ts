import { readFile } from "node:fs/promises";
import { encodeSnapshot, type WarpSnapshot } from "@warpstate/core";
import { captureWarp, expect, test, warpLocation } from "@warpstate/playwright";
import type { Page } from "@playwright/test";

const apiCalls = (page: Page) => page.evaluate(() => window.__apiCalls ?? []);
const readSnapshot = async (name: string): Promise<WarpSnapshot> =>
  JSON.parse(await readFile(`e2e/snapshots/${name}.warp.json`, "utf8"));

test.describe("opening scenarios with warp()", () => {
  test("cart with coupon renders in one go, without hitting the API", async ({ page, warp }) => {
    await warp("e2e/snapshots/cart-with-coupon.warp.json");

    await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
    await expect(page.getByTestId("coupon")).toHaveText("Coupon WARP10 applied");
    await expect(page.getByTestId("total")).toHaveText("$47.7");
    await expect(page.getByTestId("cart-link")).toHaveText("Cart (3)");
    expect(await apiCalls(page)).toEqual([]);
  });

  test("the history stack is restored too", async ({ page, warp }) => {
    await warp("e2e/snapshots/cart-with-coupon.warp.json");

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Warp Mug" })).toBeVisible();
    await expect(page.getByTestId("in-cart")).toHaveText("2 in cart");
    expect(await warpLocation(page)).toBe("/products/1");

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
    // Every screen came from the restored query cache.
    expect(await apiCalls(page)).toEqual([]);
  });

  test("checkout review: the remaining step works against the real app", async ({ page, warp }) => {
    await warp("e2e/snapshots/checkout-review.warp.json");

    await expect(page.getByTestId("ship-to")).toHaveText("Ship to Ada Lovelace, 12 Analytical Row, London");
    await expect(page.getByTestId("review-total")).toHaveText("$19");
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByTestId("order-id")).toHaveText("Order WS-1019 confirmed.");
    expect(await apiCalls(page)).toEqual(["order"]);
  });

  test("search params and their cached results", async ({ page, warp }) => {
    await warp("e2e/snapshots/search-results.warp.json");

    await expect(page.getByLabel("Search")).toHaveValue("mug");
    await expect(page.getByLabel("Sort")).toHaveValue("price");
    await expect(page.getByRole("list", { name: "Product list" }).getByRole("listitem")).toHaveText([
      /Warp Mug/,
      /Mug of Holding/,
    ]);
    expect(await apiCalls(page)).toEqual([]);
  });

  test("the address bar follows the restored route", async ({ page, warp }) => {
    await warp("e2e/snapshots/cart-with-coupon.warp.json");
    expect(new URL(page.url()).pathname).toBe("/cart");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Warp Mug" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/products/1");
  });

  test('query: "refetch" keeps route and stores but loads data from the API', async ({ page, warp }) => {
    await warp("e2e/snapshots/cart-with-coupon.warp.json", { query: "refetch" });
    await expect(page.getByTestId("coupon")).toHaveText("Coupon WARP10 applied");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Warp Mug" })).toBeVisible();
    expect(await apiCalls(page)).toContain("product/1");
  });

  test("compact snapshots work the same way", async ({ page, warp }) => {
    const compact = await encodeSnapshot(await readSnapshot("cart-with-coupon"));
    expect(compact.length).toBeLessThan(JSON.stringify(await readSnapshot("cart-with-coupon")).length);
    await warp(compact);
    await expect(page.getByTestId("total")).toHaveText("$47.7");
  });
});

test.describe("?warp= links (dev server)", () => {
  test("a plain link opens the app in a scenario: no test fixture, no agent tooling", async ({ page }) => {
    await page.goto("/?warp=checkout-review");
    await expect(page.getByTestId("ship-to")).toHaveText("Ship to Ada Lovelace, 12 Analytical Row, London");
    await expect.poll(() => page.evaluate(() => window.__WARPSTATE__?.status)).toBe("ready");
    expect(await warpLocation(page)).toBe("/checkout?step=review");
    expect(await apiCalls(page)).toEqual([]);

    // The address bar shows the route and keeps the link param...
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/checkout?step=review&warp=checkout-review");
    // ...so reloading resets the screen to the same state.
    await page.getByRole("button", { name: "Back" }).click();
    await page.reload();
    await expect(page.getByTestId("ship-to")).toBeVisible();
  });

  test("an unknown id says which ones exist and the app still boots", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto("/?warp=nope");
    await expect(page.getByRole("heading", { name: "Welcome to Warp Shop" })).toBeVisible();
    // The catalog also lists snapshots saved by tests (test-results/), so check inclusion.
    expect(errors.join("\n")).toMatch(/Unknown scenario "nope" in \?warp=\. Known ids: .*cart-with-coupon, checkout-review, search-results/);
  });
});

test.describe("safety nets", () => {
  test("obsolete snapshots are rejected with a clear error", async ({ warp }) => {
    const snapshot = await readSnapshot("cart-with-coupon");
    snapshot.app = { ...snapshot.app, schemaVersion: "0" };
    await expect(warp(snapshot)).rejects.toThrow(/OBSOLETE_SNAPSHOT.*"0" but the app expects "1"/);
  });

  test("invalid snapshots fail before the page is touched", async ({ page, warp }) => {
    await expect(warp({ warpstate: 1, router: { entries: [], index: 0 } } as never)).rejects.toThrow(
      /router\.entries/,
    );
    expect(page.url()).toBe("about:blank");
  });

  test("without a snapshot the app boots normally and fetches", async ({ page }) => {
    await page.goto("/products");
    await expect(page.getByRole("link", { name: /Warp Mug/ })).toBeVisible();
    expect(await page.evaluate(() => window.__WARPSTATE__?.status)).toBe("idle");
    expect(await apiCalls(page)).toEqual(["products?q=&sort=relevance"]);
  });
});

test.describe("capturing", () => {
  test("capture → warp round-trips the modified state", async ({ page, warp, browser }) => {
    await warp("e2e/snapshots/cart-with-coupon.warp.json");
    await page.getByRole("button", { name: "Remove Snapshot Tee" }).click();
    await expect(page.getByTestId("total")).toHaveText("$25.2");

    const captured = await captureWarp(page, { name: "after removal" });
    expect(captured.router).toEqual({ entries: ["/", "/products?q=&sort=relevance", "/products/1", "/cart"], index: 3 });

    const other = await browser.newPage();
    const { warp: warpOther } = await import("@warpstate/playwright");
    await warpOther(other, captured);
    await expect(other.getByTestId("total")).toHaveText("$25.2");
    await expect(other.getByTestId("cart-link")).toHaveText("Cart (2)");
    await other.close();
  });

  test("Ctrl+Shift+S downloads a .warp.json file", async ({ page, warp }) => {
    await warp("e2e/snapshots/search-results.warp.json");
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Control+Shift+S")]);
    expect(download.suggestedFilename()).toBe("products.warp.json");
    const file = JSON.parse(await readFile(await download.path(), "utf8")) as WarpSnapshot;
    expect(file.router.entries.at(-1)).toBe("/products?q=mug&sort=price");
    expect(file.app).toEqual({ name: "warp-shop", schemaVersion: "1" });
  });
});

test.describe("agents (WebMCP)", () => {
  test.beforeEach(async ({ page }) => {
    // Minimal stand-in for a browser with WebMCP (document.modelContext).
    await page.addInitScript(() => {
      const tools: Record<string, { execute: (input: object) => Promise<unknown> }> = {};
      Object.assign(window, { __tools: tools });
      Object.defineProperty(document, "modelContext", {
        value: { registerTool: async (tool: { name: string; execute: () => Promise<unknown> }) => void (tools[tool.name] = tool) },
      });
    });
  });

  const callTool = (page: Page, name: string, input: object = {}) =>
    page.evaluate(
      async ([n, i]) => {
        const tools = (window as unknown as { __tools: Record<string, { execute: (x: object) => Promise<{ structuredContent: unknown }> }> }).__tools;
        return (await tools[n as string]!.execute(i as object)).structuredContent as Record<string, unknown>;
      },
      [name, input] as const,
    );

  test("an agent can capture the current state and load another scenario", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome to Warp Shop" })).toBeVisible();

    const status = await callTool(page, "warpstate_status");
    expect(status).toMatchObject({ status: "idle", adapters: ["query", "cart", "checkout", "router"] });

    const captured = await callTool(page, "warpstate_capture", { name: "home" });
    expect(captured.format).toBe("json"); // small snapshot: JSON costs fewer tokens than base64
    expect(captured.snapshot).toMatchObject({ warpstate: 1, meta: { name: "home" } });
    const compact = await callTool(page, "warpstate_capture", { format: "compact" });
    expect(String(compact.snapshot)).toMatch(/^warp1\./);

    const checkout = await encodeSnapshot(await readSnapshot("checkout-review"));
    await Promise.all([page.waitForEvent("load"), callTool(page, "warpstate_load", { snapshot: checkout })]);
    await expect(page.getByTestId("ship-to")).toHaveText("Ship to Ada Lovelace, 12 Analytical Row, London");
    await expect.poll(async () => (await callTool(page, "warpstate_status")).status).toBe("ready");
  });
});
