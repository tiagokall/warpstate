/**
 * End-to-end validation against Chrome's real WebMCP implementation (no polyfill,
 * no fake modelContext). Run with `pnpm e2e:webmcp`, or `pnpm e2e:webmcp:chrome`
 * to use the locally installed Google Chrome instead of Playwright's Chromium.
 */
import { readFile } from "node:fs/promises";
import { decodeSnapshot, encodeSnapshot, type WarpSnapshot } from "@warpstate/core";
import { expect, test } from "@playwright/test";
import { WebMcpAgent, structured } from "./agent";

const TOOLS = ["warpstate_status", "warpstate_capture", "warpstate_load"];
const readSnapshot = async (name: string): Promise<WarpSnapshot> =>
  JSON.parse(await readFile(`e2e/snapshots/${name}.warp.json`, "utf8"));

test.beforeEach(async ({ page }) => {
  // Fail (never skip) when the browser has no WebMCP, so a renamed Chrome feature
  // flag cannot silently turn this suite into a no-op.
  await page.goto("/");
  const available = await page.evaluate(() => "modelContext" in document);
  expect(available, "WebMCP is not enabled in this browser (launch with --enable-features=WebMCP)").toBe(true);
});

test("the app registers its tools with the browser, with schemas and annotations", async ({ page }) => {
  const agent = await WebMcpAgent.attach(page);
  await page.reload();
  const [status, capture, load] = await agent.waitForTools(TOOLS);

  expect(status!.annotations).toMatchObject({ readOnly: true, debugging: true });
  expect(capture!.annotations).toMatchObject({ readOnly: true, debugging: true });
  expect(load!.annotations).toMatchObject({ readOnly: false, consequential: true });
  expect(load!.inputSchema).toMatchObject({ required: ["snapshot"] });

  // The page sees the same registry through the spec API.
  const names = await page.evaluate(async () => {
    // TypeScript's DOM lib does not know WebMCP yet.
    const modelContext = (document as unknown as { modelContext: { getTools(): Promise<Array<{ name: string }>> } })
      .modelContext;
    return (await modelContext.getTools()).map((t) => t.name).sort();
  });
  expect(names).toEqual([...TOOLS].sort());
});

test("status and capture through WebMCP.invokeTool", async ({ page }) => {
  const agent = await WebMcpAgent.attach(page);
  await page.reload();

  const status = await agent.invoke("warpstate_status");
  expect(status.status).toBe("Completed");
  expect(structured(status)).toMatchObject({
    status: "idle",
    bootedFromSnapshot: false,
    adapters: expect.arrayContaining(["router", "query", "cart", "checkout"]),
  });

  const auto = structured(await agent.invoke("warpstate_capture", { name: "home via chrome" }));
  expect(auto.format).toBe("json");
  expect(auto.snapshot).toMatchObject({ warpstate: 1, meta: { name: "home via chrome" }, app: { name: "warp-shop" } });

  const compact = structured(await agent.invoke("warpstate_capture", { format: "compact" }));
  expect(compact.format).toBe("compact");
  const decoded = await decodeSnapshot(compact.snapshot);
  expect(decoded.router.entries.at(-1)).toBe("/");
});

test("an agent loads a scenario: the page reloads into it and re-registers its tools", async ({ page }) => {
  const agent = await WebMcpAgent.attach(page);
  await page.reload();
  await agent.waitForTools(TOOLS);

  const snapshot = await encodeSnapshot(await readSnapshot("checkout-review"));
  const reloaded = page.waitForEvent("load");
  const response = await agent.invoke("warpstate_load", { snapshot });
  expect(response.status).toBe("Completed");
  expect(structured(response)).toEqual({ loading: "Checkout review", reloading: true });

  agent.forgetTools();
  await reloaded;
  await expect(page.getByTestId("ship-to")).toHaveText("Ship to Ada Lovelace, 12 Analytical Row, London");

  // The new document registered fresh tools; the agent keeps working with them.
  await agent.waitForTools(TOOLS);
  await expect
    .poll(async () => structured(await agent.invoke("warpstate_status")).status)
    .toBe("ready");
  expect(structured(await agent.invoke("warpstate_status"))).toMatchObject({
    bootedFromSnapshot: "Checkout review",
    location: "/checkout?step=review",
  });

  // And the restored app is fully usable.
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByTestId("order-id")).toHaveText("Order WS-1019 confirmed.");
});

test("invalid snapshots come back as tool errors and leave the page alone", async ({ page }) => {
  const agent = await WebMcpAgent.attach(page);
  await page.reload();
  let navigated = false;
  page.on("framenavigated", () => (navigated = true));

  const response = await agent.invoke("warpstate_load", { snapshot: "warp1.definitely-not-valid" });
  const result = structured(response);
  expect(result.error).toMatch(/not a valid compact warpstate string/);
  expect(response.output?.isError).toBe(true);
  await page.waitForTimeout(300);
  expect(navigated).toBe(false);
});
