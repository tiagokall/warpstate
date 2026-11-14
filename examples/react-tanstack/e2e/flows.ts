/**
 * Click-through flows that reach each scenario through the UI, plus the checks
 * that prove the scenario is on screen. Used to record snapshots and as the
 * "without warpstate" side of the benchmark.
 */
import { expect, type Page } from "@playwright/test";

/** Runs one user-level action. The benchmark wraps it to measure what an agent would read. */
export type Step = (label: string, action: () => Promise<unknown>, typed?: string) => Promise<void>;

export const plainStep: Step = async (_label, action) => {
  await action();
};

async function openProduct(page: Page, step: Step, title: string) {
  await step(`click product "${title}"`, () => page.getByRole("link", { name: new RegExp(title) }).click());
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

export interface Scenario {
  file: string;
  reach: (page: Page, step?: Step) => Promise<void>;
  verify: (page: Page) => Promise<void>;
}

export const scenarios: Record<string, Scenario> = {
  "cart-with-coupon": {
    file: "e2e/snapshots/cart-with-coupon.warp.json",
    async reach(page, step = plainStep) {
      await step("open /", () => page.goto("/"));
      await step('click "Products"', () => page.getByRole("link", { name: "Products" }).click());
      await openProduct(page, step, "Snapshot Tee");
      await step('click "Add to cart"', () => page.getByRole("button", { name: "Add to cart" }).click());
      await step('click "Back"', () => page.getByRole("button", { name: "Back" }).click());
      await openProduct(page, step, "Warp Mug");
      await step('click "Add to cart"', () => page.getByRole("button", { name: "Add to cart" }).click());
      await step('click "Add to cart"', () => page.getByRole("button", { name: "Add to cart" }).click());
      await step('click "Cart"', () => page.getByTestId("cart-link").click());
      await step('type coupon', () => page.getByLabel("Coupon").fill("warp10"), "warp10");
      await step('click "Apply"', () => page.getByRole("button", { name: "Apply" }).click());
    },
    async verify(page) {
      await expect(page.getByTestId("coupon")).toHaveText("Coupon WARP10 applied");
      await expect(page.getByTestId("total")).toHaveText("$47.7");
    },
  },
  "checkout-review": {
    file: "e2e/snapshots/checkout-review.warp.json",
    async reach(page, step = plainStep) {
      await step("open /products", () => page.goto("/products"));
      await openProduct(page, step, "Hydration Bottle");
      await step('click "Add to cart"', () => page.getByRole("button", { name: "Add to cart" }).click());
      await step('click "Cart"', () => page.getByTestId("cart-link").click());
      await step('click "Checkout"', () => page.getByRole("link", { name: "Checkout" }).click());
      await step("type name", () => page.getByLabel("Full name").fill("Ada Lovelace"), "Ada Lovelace");
      await step("type street", () => page.getByLabel("Street").fill("12 Analytical Row"), "12 Analytical Row");
      await step("type city", () => page.getByLabel("City").fill("London"), "London");
      await step('click "Continue to payment"', () => page.getByRole("button", { name: "Continue to payment" }).click());
      await step('check "Pix"', () => page.getByLabel("Pix").check());
      await step('click "Review order"', () => page.getByRole("button", { name: "Review order" }).click());
    },
    async verify(page) {
      await expect(page.getByTestId("ship-to")).toHaveText("Ship to Ada Lovelace, 12 Analytical Row, London");
      await expect(page.getByTestId("review-total")).toHaveText("$19");
    },
  },
  "search-results": {
    file: "e2e/snapshots/search-results.warp.json",
    async reach(page, step = plainStep) {
      await step("open /products", () => page.goto("/products"));
      await step("type search", () => page.getByLabel("Search").fill("mug"), "mug");
      await step('click "Search"', () => page.getByRole("button", { name: "Search" }).click());
      await step('select sort "price"', () => page.getByLabel("Sort").selectOption("price"));
    },
    async verify(page) {
      await expect(page.getByRole("list", { name: "Product list" }).getByRole("listitem")).toHaveText([
        /Warp Mug/,
        /Mug of Holding/,
      ]);
    },
  },
};
