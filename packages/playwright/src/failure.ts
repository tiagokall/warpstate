import { writeFile } from "node:fs/promises";
import { basename, relative, sep } from "node:path";
import type { TestInfo, test as base } from "@playwright/test";
import { serializeSnapshot, type WarpSnapshot } from "@warpstate/core";

/** When to save the app state at the end of a test. */
export type WarpCaptureMode = "on-failure" | "always" | "off";

export interface FailureSnapshotFixtures {
  /** Default `"on-failure"`. Set per project or file with `test.use({ warpCapture: "always" })`. */
  warpCapture: WarpCaptureMode;
  /** @internal Auto fixture that saves the snapshots. */
  warpCaptureOnFailure: void;
}

// Terminal color codes in Playwright error messages (ESC [ … m).
const ANSI_COLORS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const slug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** File name (= catalog id) for a test's snapshot: `<spec>--<title>[-retryN][-pageN]`. */
export function failureSnapshotName(testInfo: Pick<TestInfo, "file" | "title" | "retry">, pageIndex = 0): string {
  const spec = slug(basename(testInfo.file).replace(/\.(spec|test)\.[cm]?[jt]sx?$/, ""));
  const title = slug(testInfo.title).slice(0, 60).replace(/-$/, "");
  return `${spec}--${title}${testInfo.retry ? `-retry${testInfo.retry}` : ""}${pageIndex ? `-page${pageIndex + 1}` : ""}`;
}

function howToOpen(id: string, file: string, testInfo: TestInfo): string {
  const baseURL = (testInfo.project.use as { baseURL?: string }).baseURL ?? "http://localhost:5173";
  const outputDir = relative(process.cwd(), testInfo.project.outputDir).split(sep).join("/") || ".";
  return [
    "Open the app in the state this test ended in:",
    "",
    `  ${baseURL.replace(/\/$/, "")}/?warp=${encodeURIComponent(id)}`,
    "",
    "Needs the dev server with the test output in the scenario catalog:",
    `  warpstate({ scenarios: ["…", "${outputDir}"] })   // vite.config`,
    "",
    `Or in a test: await warp(${JSON.stringify(relative(process.cwd(), file).split(sep).join("/"))})`,
  ].join("\n");
}

/**
 * Auto fixture: when a test fails (or always, with `warpCapture: "always"`),
 * captures the warpstate snapshot of every open page and attaches it to the
 * report, with a link that reopens the app in that exact state. Pages without
 * the warpstate runtime (e.g. production builds) are skipped silently.
 */
export const failureSnapshotFixtures: Parameters<typeof base.extend<FailureSnapshotFixtures>>[0] = {
  warpCapture: ["on-failure", { option: true }],
  warpCaptureOnFailure: [
    async ({ context, warpCapture }, use, testInfo) => {
      await use();
      const failed = testInfo.status !== testInfo.expectedStatus;
      if (warpCapture === "off" || (warpCapture === "on-failure" && !failed)) return;

      const error = testInfo.errors[0]?.message?.replace(ANSI_COLORS, "").split("\n")[0]?.slice(0, 300);
      const meta: WarpSnapshot["meta"] = {
        name: testInfo.titlePath.slice(1).join(" › "),
        description: `${failed ? "Failed" : "Ended"}: ${testInfo.title}${error ? ` — ${error}` : ""} (${basename(testInfo.file)}:${testInfo.line})`,
      };
      for (const [index, page] of context.pages().entries()) {
        try {
          const snapshot = await page.evaluate(
            (m) => window.__WARPSTATE__?.capture?.(m) ?? null,
            meta,
          );
          if (!snapshot) continue;
          const id = failureSnapshotName(testInfo, index);
          const file = testInfo.outputPath(`${id}.warp.json`);
          await writeFile(file, serializeSnapshot(snapshot as WarpSnapshot), "utf8");
          await testInfo.attach(`warpstate snapshot${index ? ` (page ${index + 1})` : ""}`, {
            path: file,
            contentType: "application/json",
          });
          await testInfo.attach(`open this state${index ? ` (page ${index + 1})` : ""}`, {
            body: howToOpen(id, file, testInfo),
            contentType: "text/plain",
          });
        } catch {
          // Closed or crashed page: nothing to capture.
        }
      }
    },
    { auto: true },
  ],
};
