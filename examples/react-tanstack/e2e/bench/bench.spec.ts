/**
 * Benchmark: reaching each scenario by clicking through the UI vs. warp().
 *
 *   pnpm bench                       # defaults below
 *   BENCH_ITERATIONS=15 BENCH_LATENCIES=0,100,600 pnpm bench
 *
 * Writes bench/results.json and bench/RESULTS.md.
 *
 * 1. CI time: wall-clock from a fresh browser context to the scenario's final
 *    assertion passing. Modes are interleaved per iteration to spread drift,
 *    and one warm-up round is discarded.
 * 2. Agent tokens: a model of a browser agent (Playwright-MCP style) where every
 *    action costs its tool call plus the ARIA snapshot of the page it gets back.
 *    Bytes are measured; tokens are estimated (see TOKENS below).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { encodeSnapshot, type WarpSnapshot } from "@warpstate/core";
import { warp } from "@warpstate/playwright";
import { test, type Browser, type Page } from "@playwright/test";
import { scenarios, type Step } from "../flows";

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 7);
const LATENCIES = (process.env.BENCH_LATENCIES ?? "0,300").split(",").map(Number);

/**
 * Token estimate. Plain text and JSON average ~4 characters per token with
 * modern BPE tokenizers; base64 tokenizes much worse, so the compact string is
 * counted at 2 characters per token (deliberately pessimistic for warpstate).
 */
const TOKENS = { textCharsPerToken: 4, base64CharsPerToken: 2 };
const textTokens = (s: string) => Math.ceil(s.length / TOKENS.textCharsPerToken);
const base64Tokens = (s: string) => Math.ceil(s.length / TOKENS.base64CharsPerToken);

type Mode = "click-through" | "warp";
interface TimingRow { scenario: string; latencyMs: number; mode: Mode; samplesMs: number[] }
interface AgentRow {
  scenario: string;
  mode: "click-through" | "warp (compact)" | "warp (json)";
  toolCalls: number;
  inputChars: number; // what the agent writes (tool call arguments)
  outputChars: number; // what the agent reads back (tool results)
  estimatedTokens: number;
}

const timings: TimingRow[] = [];
const agentRows: AgentRow[] = [];

test.describe.configure({ mode: "serial" });

async function freshPage(browser: Browser, baseURL: string, latency: number) {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript((ms) => {
    window.__API_LATENCY__ = ms;
  }, latency);
  return { context, page: await context.newPage() };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]!;

test("CI time: click-through vs warp()", async ({ browser }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const baseURL = String(testInfo.project.use.baseURL);

  for (const latency of LATENCIES) {
    for (const [id, scenario] of Object.entries(scenarios)) {
      const rows: Record<Mode, TimingRow> = {
        "click-through": { scenario: id, latencyMs: latency, mode: "click-through", samplesMs: [] },
        warp: { scenario: id, latencyMs: latency, mode: "warp", samplesMs: [] },
      };
      for (let i = -1; i < ITERATIONS; i += 1) {
        const order: Mode[] = i % 2 ? ["click-through", "warp"] : ["warp", "click-through"];
        for (const mode of order) {
          const { context, page } = await freshPage(browser, baseURL, latency);
          const start = performance.now();
          if (mode === "warp") await warp(page, scenario.file);
          else await scenario.reach(page);
          await scenario.verify(page);
          const elapsed = performance.now() - start;
          await context.close();
          if (i >= 0) rows[mode].samplesMs.push(Math.round(elapsed));
        }
      }
      timings.push(rows["click-through"], rows.warp);
    }
  }
});

async function ariaSnapshot(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(150); // let the UI settle, as an agent's snapshot would
  return page.locator("body").ariaSnapshot();
}

function toolFor(label: string) {
  if (label.startsWith("open")) return "browser_navigate";
  if (label.startsWith("type")) return "browser_type";
  if (label.startsWith("select")) return "browser_select_option";
  return "browser_click";
}

test("agent tokens: click-through vs warpstate_load", async ({ browser }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const baseURL = String(testInfo.project.use.baseURL);

  for (const [id, scenario] of Object.entries(scenarios)) {
    // Click-through: every action is a tool call answered with a page snapshot.
    {
      const { context, page } = await freshPage(browser, baseURL, 0);
      let calls = 0;
      let inputChars = 0;
      let outputChars = 0;
      const step: Step = async (label, action, typed) => {
        await action();
        const call = JSON.stringify({
          tool: toolFor(label),
          args: { element: label, ref: "e123", ...(typed ? { text: typed } : {}) },
        });
        const result = await ariaSnapshot(page);
        calls += 1;
        inputChars += call.length;
        outputChars += result.length;
      };
      await scenario.reach(page, step);
      await scenario.verify(page);
      await context.close();
      agentRows.push({
        scenario: id,
        mode: "click-through",
        toolCalls: calls,
        inputChars,
        outputChars,
        estimatedTokens: Math.ceil((inputChars + outputChars) / TOKENS.textCharsPerToken),
      });
    }

    // warpstate: open the app, load the snapshot, read the resulting page once.
    const snapshot = JSON.parse(await readFile(scenario.file, "utf8")) as WarpSnapshot;
    const payloads = {
      "warp (compact)": await encodeSnapshot(snapshot),
      "warp (json)": JSON.stringify(snapshot),
    } as const;

    for (const [mode, payload] of Object.entries(payloads) as Array<[keyof typeof payloads, string]>) {
      const { context, page } = await freshPage(browser, baseURL, 0);
      const navigateCall = JSON.stringify({ tool: "browser_navigate", args: { url: `${baseURL}/` } });
      await page.goto("/");
      const homeSnapshot = await ariaSnapshot(page);

      const loadCall = JSON.stringify({ tool: "warpstate_load", args: { snapshot: mode === "warp (json)" ? snapshot : payload } });
      const loadResult = JSON.stringify({ loading: snapshot.meta?.name, reloading: true });
      await Promise.all([
        page.waitForEvent("load"),
        page.evaluate((input) => {
          void window.__WARPSTATE__!.load!(input);
        }, payload),
      ]);
      await page.waitForFunction(() => window.__WARPSTATE__?.status === "ready");
      const snapshotCall = JSON.stringify({ tool: "browser_snapshot", args: {} });
      const finalSnapshot = await ariaSnapshot(page);
      await scenario.verify(page);
      await context.close();

      const inputChars = navigateCall.length + loadCall.length + snapshotCall.length;
      const outputChars = homeSnapshot.length + loadResult.length + finalSnapshot.length;
      const payloadTokens = mode === "warp (compact)" ? base64Tokens(payload) : textTokens(payload);
      agentRows.push({
        scenario: id,
        mode,
        toolCalls: 3,
        inputChars,
        outputChars,
        estimatedTokens:
          payloadTokens + Math.ceil((inputChars - payload.length + outputChars) / TOKENS.textCharsPerToken),
      });
    }
  }
});

test.afterAll(async () => {
  await mkdir("bench", { recursive: true });
  const meta = {
    date: new Date().toISOString(),
    iterations: ITERATIONS,
    latenciesMs: LATENCIES,
    server: "vite dev server (unbundled modules)",
    browser: "Chromium (headless)",
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    tokens: TOKENS,
  };
  await writeFile("bench/results.json", `${JSON.stringify({ meta, timings, agent: agentRows }, null, 2)}\n`);

  const lines: string[] = [
    "# warpstate benchmark",
    "",
    `Generated by \`pnpm bench\` on ${meta.date.slice(0, 10)} · ${meta.platform} · ${meta.browser} · ${meta.server} · ${ITERATIONS} runs per cell (+1 warm-up discarded).`,
    "",
    "## CI time: reaching the scenario and asserting it",
    "",
    "| Scenario | API latency | Click-through (median / p95) | warp() (median / p95) | Saved per test | Speed-up |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  const totals = new Map<number, { click: number; warp: number }>();
  for (let i = 0; i < timings.length; i += 2) {
    const click = timings[i]!;
    const w = timings[i + 1]!;
    const c = median(click.samplesMs);
    const m = median(w.samplesMs);
    const t = totals.get(click.latencyMs) ?? { click: 0, warp: 0 };
    totals.set(click.latencyMs, { click: t.click + c, warp: t.warp + m });
    lines.push(
      `| ${click.scenario} | ${click.latencyMs} ms | ${c} / ${p95(click.samplesMs)} ms | ${m} / ${p95(w.samplesMs)} ms | ${Math.round(c - m)} ms | ${(c / m).toFixed(1)}× |`,
    );
  }
  lines.push("", "Sum of medians for the three scenarios:", "");
  for (const [latency, t] of totals) {
    lines.push(`- API latency ${latency} ms: ${(t.click / 1000).toFixed(2)} s → ${(t.warp / 1000).toFixed(2)} s (${Math.round((1 - t.warp / t.click) * 100)}% less)`);
  }
  lines.push(
    "",
    "## Agent cost: getting a browser agent into the scenario",
    "",
    "Model: every action is one tool call, answered with an ARIA snapshot of the page (as Playwright MCP does).",
    `Characters are measured; tokens are estimated at ${TOKENS.textCharsPerToken} chars/token for text and ${TOKENS.base64CharsPerToken} chars/token for the base64 compact string.`,
    "",
    "| Scenario | Mode | Tool calls | Chars written | Chars read | ≈ Tokens |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  );
  for (const row of agentRows) {
    lines.push(`| ${row.scenario} | ${row.mode} | ${row.toolCalls} | ${row.inputChars} | ${row.outputChars} | ${row.estimatedTokens} |`);
  }
  lines.push(
    "",
    "## Caveats",
    "",
    "- The click-through flows are short (4–11 actions). Real setups are often longer, and the gap grows with every step.",
    "- The fake API runs in the page, so there is no real network. Real backends add latency on every click-through request, while warp() makes none.",
    "- Agent numbers count only the tokens needed to *reach* the state, not the reasoning between steps (which click-through also multiplies).",
    "- Snapshot sizes, and the warp side of the token count, grow with the amount of cached data. Large caches cost more to load, but the cost does not depend on how many steps the scenario takes.",
    "",
  );
  await writeFile("bench/RESULTS.md", lines.join("\n"));
  console.log(lines.join("\n"));
});
