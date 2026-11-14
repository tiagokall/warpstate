/**
 * Records the scenarios in e2e/snapshots by driving the UI once.
 * Run with `pnpm record`. Day to day you would capture with Ctrl+Shift+S instead;
 * this script just keeps the example's snapshots reproducible.
 */
import { captureWarp, saveSnapshot } from "@warpstate/playwright";
import { test } from "@playwright/test";
import { scenarios } from "./flows";

const descriptions: Record<string, { name: string; description: string }> = {
  "cart-with-coupon": {
    name: "Cart with coupon",
    description: "2 mugs + 1 tee, WARP10 applied; history: home → products → mug → cart",
  },
  "checkout-review": { name: "Checkout review", description: "Shipping and payment filled, on the review step" },
  "search-results": { name: "Search results", description: "'mug' sorted by price" },
};

for (const [id, scenario] of Object.entries(scenarios)) {
  test(id, async ({ page }) => {
    await scenario.reach(page);
    await scenario.verify(page);
    const snapshot = await captureWarp(page, descriptions[id]);
    delete snapshot.meta!.createdAt;
    await saveSnapshot(scenario.file, snapshot);
  });
}
