#!/usr/bin/env node
/**
 * warpstate-shots: screenshots every scenario in the dev server's catalog and,
 * optionally, compares them with an earlier run. Built for agents (and people)
 * checking what a UI change did before calling it done:
 *
 *   npx warpstate-shots --out .warpstate/shots/before          # before the change
 *   npx warpstate-shots --compare .warpstate/shots/before      # after: lists changed screens
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

interface Summary {
  id: string;
  name?: string;
  route?: string;
  file: string;
  error?: string;
}

const HELP = `Usage: warpstate-shots [options]

  --url <origin>       Dev server with the warpstate() Vite plugin (default: http://localhost:5173)
  --out <dir>          Where to write <id>.png (default: .warpstate/shots/current)
  --compare <dir>      Earlier run to diff against; writes <id>.diff.png for changed screens
  --only <ids>         Comma-separated scenario ids (default: all valid scenarios)
  --include-failures   Also shoot snapshots saved by failing tests (test-results/)
  --width <px>         Viewport width (default: 1280)
  --height <px>        Viewport height (default: 800)
  --threshold <0-1>    Per-pixel color threshold for the diff (default: 0.1)
  --storage <file>     Playwright storageState to load (e.g. a logged-in session)
  --mask <selectors>   CSS selectors painted over before shooting (clocks, live charts), comma-separated
  --tolerance <0-1>    Changed-pixel ratio still reported as "same" (default: 0.0001 = 0.01%)
`;

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5173" },
    out: { type: "string", default: ".warpstate/shots/current" },
    compare: { type: "string" },
    only: { type: "string" },
    "include-failures": { type: "boolean", default: false },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "800" },
    threshold: { type: "string", default: "0.1" },
    storage: { type: "string" },
    mask: { type: "string" },
    tolerance: { type: "string", default: "0.0001" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const origin = args.url!.replace(/\/$/, "");
const out = resolve(args.out!);

async function catalog(): Promise<Summary[]> {
  let response: Response;
  try {
    response = await fetch(`${origin}/__warpstate/scenarios`);
  } catch {
    throw new Error(`Could not reach ${origin}. Start the dev server first (or pass --url).`);
  }
  const body = response.headers.get("content-type")?.includes("json") ? ((await response.json()) as { scenarios?: Summary[] }) : {};
  if (!body.scenarios) throw new Error(`${origin} has no scenario catalog. Add warpstate() from @warpstate/vite to vite.config.`);
  return body.scenarios;
}

function diff(before: Buffer, after: Buffer, target: string, threshold: number): number {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) return 1;
  const output = new PNG({ width: a.width, height: a.height });
  const changed = pixelmatch(a.data, b.data, output.data, a.width, a.height, { threshold });
  if (changed) writeFileSync(target, PNG.sync.write(output));
  return changed / (a.width * a.height);
}

async function main() {
  const only = args.only ? new Set(args.only.split(",").map((id) => id.trim())) : null;
  const scenarios = (await catalog()).filter(
    (s) =>
      !s.error &&
      (only ? only.has(s.id) : args["include-failures"] || !s.file.split("/").includes("test-results")),
  );
  if (!scenarios.length) throw new Error("No scenarios to shoot.");
  await mkdir(out, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: Number(args.width), height: Number(args.height) },
    ...(args.storage ? { storageState: args.storage } : {}),
  });
  const report: Array<Record<string, unknown>> = [];
  for (const scenario of scenarios) {
    const page = await context.newPage();
    const row: Record<string, unknown> = { id: scenario.id, name: scenario.name, route: scenario.route };
    try {
      await page.goto(`${origin}/?warp=${encodeURIComponent(scenario.id)}`);
      await page.waitForFunction(() => ["ready", "error"].includes(window.__WARPSTATE__?.status ?? ""), null, { timeout: 30_000 });
      const status = await page.evaluate(() => window.__WARPSTATE__?.status);
      if (status === "error") throw new Error(await page.evaluate(() => window.__WARPSTATE__?.error?.message ?? "error"));
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await page.evaluate(() => document.fonts?.ready);
      // The dev overlay ("warped: …") is not part of the app's UI.
      await page.addStyleTag({ content: "[data-warpstate-overlay]{display:none!important}" });
      const shot = join(out, `${scenario.id.replace(/\//g, "__")}.png`);
      // "ready" means the route rendered; lazy chunks, skeletons and charts can
      // still be settling. Like toHaveScreenshot, wait for two identical frames.
      const mask = args.mask ? args.mask.split(",").map((selector) => page.locator(selector.trim())) : [];
      const shoot = () => page.screenshot({ fullPage: true, animations: "disabled", mask });
      let png = await shoot();
      let stable = false;
      for (let attempt = 0; attempt < 30 && !stable; attempt++) {
        await page.waitForTimeout(300);
        const next = await shoot();
        stable = next.equals(png);
        png = next;
      }
      if (!stable) row.unstable = true;
      await writeFile(shot, png);
      row.shot = shot;
      if (args.compare) {
        const previous = join(resolve(args.compare), `${scenario.id.replace(/\//g, "__")}.png`);
        if (!existsSync(previous)) row.change = "new";
        else {
          const ratio = diff(await readFile(previous), png, shot.replace(/\.png$/, ".diff.png"), Number(args.threshold));
          const changed = ratio > Number(args.tolerance);
          row.change = changed ? `${(ratio * 100).toFixed(2)}%` : "same";
          if (changed) row.diff = shot.replace(/\.png$/, ".diff.png");
        }
      }
    } catch (error) {
      row.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
    }
    report.push(row);
    await page.close();
  }
  await browser.close();
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));

  for (const row of report) {
    const status = row.error ? `error: ${String(row.error)}` : `${String(row.change ?? "ok")}${row.unstable ? " (never settled)" : ""}`;
    console.log(`${String(row.id).padEnd(40)} ${String(status).padEnd(12)} ${row.diff ?? row.shot ?? ""}`);
  }
  const changed = report.filter((r) => r.change && r.change !== "same");
  if (args.compare) console.log(`\n${changed.length} of ${report.length} screens changed. Report: ${join(out, "report.json")}`);
  if (report.some((r) => r.error)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`[warpstate-shots] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
