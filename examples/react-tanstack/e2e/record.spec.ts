/**
 * Records the scenarios in e2e/snapshots by driving the UI once.
 * Run with `pnpm record`. Day to day you would capture with Ctrl+Shift+S instead;
 * this script just keeps the example's snapshots reproducible.
 */
import { captureWarp, saveSnapshot } from "@warpstate/playwright";
import { expect, test, type Page } from "@playwright/test";

const out = (name: string) => `e2e/snapshots/${name}.warp.json`;

async function openProduct(page: Page, title: string) {
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("cart with coupon", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Products" }).click();
  await openProduct(page, "Snapshot Tee");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await openProduct(page, "Warp Mug");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByTestId("cart-link").click();
  await page.getByLabel("Coupon").fill("warp10");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("coupon")).toBeVisible();

  const snapshot = await captureWarp(page, {
    name: "Cart with coupon",
    description: "2 mugs + 1 tee, WARP10 applied; history: home → products → mug → cart",
  });
  delete snapshot.meta!.createdAt;
  await saveSnapshot(out("cart-with-coupon"), snapshot);
});

test("checkout review", async ({ page }) => {
  await page.goto("/products");
  await openProduct(page, "Hydration Bottle");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByTestId("cart-link").click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Street").fill("12 Analytical Row");
  await page.getByLabel("City").fill("London");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByLabel("Pix").check();
  await page.getByRole("button", { name: "Review order" }).click();
  await expect(page.getByTestId("ship-to")).toBeVisible();

  const snapshot = await captureWarp(page, {
    name: "Checkout review",
    description: "Shipping and payment filled, on the review step",
  });
  delete snapshot.meta!.createdAt;
  await saveSnapshot(out("checkout-review"), snapshot);
});

test("search results", async ({ page }) => {
  await page.goto("/products");
  await page.getByLabel("Search").fill("mug");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Sort").selectOption("price");
  await expect(page.getByRole("list", { name: "Product list" }).getByRole("listitem")).toHaveCount(2);

  const snapshot = await captureWarp(page, { name: "Search results", description: "'mug' sorted by price" });
  delete snapshot.meta!.createdAt;
  await saveSnapshot(out("search-results"), snapshot);
});
