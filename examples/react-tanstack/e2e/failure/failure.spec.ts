// Failure snapshots (@warpstate/playwright): the state a test ended in is saved
// next to its report and can be reopened with ?warp=<id>.
import { readFile } from "node:fs/promises";
import { decodeSnapshot } from "@warpstate/core";
import { expect, failureSnapshotName, test } from "@warpstate/playwright";

test.describe("saved end state", () => {
  test.use({ warpCapture: "always" }); // same code path as a failure, but this test passes
  let saved = "";

  test("the app state is saved when the test ends", async ({ page, warp }, testInfo) => {
    await warp("e2e/snapshots/cart-with-coupon.warp.json");
    await page.getByRole("button", { name: "Remove Snapshot Tee" }).click();
    await expect(page.getByTestId("total")).toHaveText("$25.2");
    saved = testInfo.outputPath(`${failureSnapshotName(testInfo)}.warp.json`);
  });

  test.afterAll(async () => {
    const snapshot = await decodeSnapshot(await readFile(saved, "utf8"));
    expect(snapshot.meta?.name).toContain("the app state is saved when the test ends");
    expect(snapshot.router.entries.at(-1)).toBe("/cart");
    expect((snapshot.stores?.cart as { items: unknown[] }).items).toHaveLength(1);
  });
});

// Run with FAILURE_DEMO=1 to see a real failure report with the snapshot attached.
test("checkout total (fails on purpose)", async ({ page, warp }) => {
  test.skip(!process.env.FAILURE_DEMO, "demo of failure snapshots; run with FAILURE_DEMO=1");
  await warp("e2e/snapshots/cart-with-coupon.warp.json");
  await page.getByRole("button", { name: "Remove Snapshot Tee" }).click();
  await expect(page.getByTestId("total")).toHaveText("$999", { timeout: 1_000 });
});
