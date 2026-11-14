import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { encodeSnapshot, type WarpSnapshot } from "@warpstate/core";
import { describe, expect, it, vi } from "vitest";
import { loadSnapshotInput, saveSnapshot, warp } from "../src";

const snapshot: WarpSnapshot = { warpstate: 1, router: { entries: ["/", "/cart?step=2"], index: 1 } };

function fakePage(status: "ready" | "error" | "pending", error?: { code: string; message: string }) {
  const page = {
    addInitScript: vi.fn(async () => undefined),
    goto: vi.fn(async () => null),
    waitForFunction: vi.fn(async () => {
      if (status === "pending") throw new Error("Timeout 10ms exceeded.");
      return null;
    }),
    evaluate: vi.fn(async () => ({ status, error, warnings: [] })),
  };
  return page as unknown as Page & typeof page;
}

async function tempFile(name: string, content: string) {
  const dir = await mkdtemp(join(tmpdir(), "warpstate-"));
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe("loadSnapshotInput", () => {
  it("reads .warp.json files", async () => {
    const path = await tempFile("cart.warp.json", JSON.stringify(snapshot));
    expect(await loadSnapshotInput(path)).toEqual(snapshot);
  });

  it("reads compact files and strings", async () => {
    const encoded = await encodeSnapshot(snapshot);
    expect(await loadSnapshotInput(await tempFile("cart.warp", `${encoded}\n`))).toEqual(snapshot);
    expect(await loadSnapshotInput(encoded)).toEqual(snapshot);
  });

  it("names the file in validation errors", async () => {
    const path = await tempFile("broken.warp.json", JSON.stringify({ warpstate: 1, router: { entries: [] } }));
    await expect(loadSnapshotInput(path)).rejects.toThrow(/broken\.warp\.json[\s\S]*router\.entries/);
  });

  it("reports missing files", async () => {
    await expect(loadSnapshotInput("nope/missing.warp.json")).rejects.toThrow(/Cannot read snapshot file/);
  });
});

describe("warp", () => {
  it("injects before navigating to the snapshot's current entry", async () => {
    const page = fakePage("ready");
    await warp(page, snapshot);
    const script = (page.addInitScript.mock.calls as unknown as Array<[{ content: string }]>)[0]![0];
    expect(script.content).toContain("__WARPSTATE__");
    expect(script.content).toContain("/cart?step=2");
    expect(page.goto).toHaveBeenCalledWith("/cart?step=2");
    expect(page.addInitScript.mock.invocationCallOrder[0]).toBeLessThan(page.goto.mock.invocationCallOrder[0]!);
  });

  it("honours a custom url", async () => {
    const page = fakePage("ready");
    await warp(page, snapshot, { url: "/" });
    expect(page.goto).toHaveBeenCalledWith("/");
  });

  it("fails before touching the page when the snapshot is invalid", async () => {
    const page = fakePage("ready");
    await expect(warp(page, { warpstate: 1 } as never)).rejects.toThrow(/Invalid warpstate snapshot/);
    expect(page.addInitScript).not.toHaveBeenCalled();
  });

  it("surfaces app-side rejections such as obsolete snapshots", async () => {
    const page = fakePage("error", { code: "OBSOLETE_SNAPSHOT", message: "expects \"2\"" });
    await expect(warp(page, snapshot)).rejects.toThrow(/rejected the snapshot \[OBSOLETE_SNAPSHOT\]/);
  });

  it("explains a missing integration on timeout", async () => {
    const page = fakePage("pending");
    await expect(warp(page, snapshot, { timeout: 10 })).rejects.toThrow(/never picked up the snapshot[\s\S]*createWarpRouter/);
  });
});

describe("saveSnapshot", () => {
  it("writes pretty JSON or the compact form by extension", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warpstate-"));
    await saveSnapshot(join(dir, "a.warp.json"), snapshot);
    await saveSnapshot(join(dir, "a.warp"), snapshot);
    expect(JSON.parse(await readFile(join(dir, "a.warp.json"), "utf8"))).toEqual(snapshot);
    expect(await readFile(join(dir, "a.warp"), "utf8")).toMatch(/^warp1\./);
  });
});
