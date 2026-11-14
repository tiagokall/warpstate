import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeSnapshot } from "@warpstate/core";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCENARIOS_ENDPOINT, warpstate } from "../src";

const snapshot = (name: string, route: string) => ({
  warpstate: 1,
  meta: { name, description: `${name} description` },
  app: { name: "shop", schemaVersion: "1" },
  router: { entries: ["/", route], index: 1 },
  stores: { cart: { items: [] } },
  query: { queries: [] },
});

let server: ViteDevServer;
let base: string;

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "warpstate-catalog-"));
  await mkdir(join(root, "e2e/snapshots/nested"), { recursive: true });
  await mkdir(join(root, "node_modules/pkg"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html>");
  await writeFile(join(root, "e2e/snapshots/cart.warp.json"), JSON.stringify(snapshot("Cart", "/cart")));
  await writeFile(join(root, "e2e/snapshots/promo.warp"), await encodeSnapshot(snapshot("Promo", "/promo") as never));
  await writeFile(join(root, "e2e/snapshots/broken.warp.json"), JSON.stringify({ warpstate: 1 }));
  await writeFile(join(root, "e2e/snapshots/nested/cart.warp.json"), JSON.stringify(snapshot("Other cart", "/c2")));
  await writeFile(join(root, "node_modules/pkg/ignored.warp.json"), JSON.stringify(snapshot("Ignored", "/x")));

  server = await createServer({ root, configFile: false, logLevel: "silent", plugins: [warpstate()], server: { port: 0 } });
  await server.listen();
  base = `http://localhost:${(server.httpServer!.address() as AddressInfo).port}${SCENARIOS_ENDPOINT}`;
}, 30_000);

afterAll(() => server?.close());

const get = async (path = "") => {
  const res = await fetch(base + path);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("dev-server scenario catalog", () => {
  it("lists every scenario with what an agent needs to pick one", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    const scenarios = body.scenarios as Array<Record<string, unknown>>;
    expect(scenarios.map((s) => s.id)).toEqual(["broken", "cart", "nested/cart", "promo"]);
    expect(scenarios.find((s) => s.id === "cart")).toEqual({
      id: "cart",
      name: "Cart",
      description: "Cart description",
      route: "/cart",
      historyLength: 2,
      restores: ["cart", "query"],
      app: { name: "shop", schemaVersion: "1" },
      file: "e2e/snapshots/cart.warp.json",
    });
    expect(scenarios.find((s) => s.id === "broken")?.error).toMatch(/router/);
  });

  it("serves a scenario by id, decoding compact files", async () => {
    expect((await get("/cart")).body.meta).toEqual({ name: "Cart", description: "Cart description" });
    expect((await get("/promo")).body.router).toEqual({ entries: ["/", "/promo"], index: 1 });
    expect((await get("/nested/cart")).body.meta).toMatchObject({ name: "Other cart" });
  });

  it("reports unknown and invalid scenarios", async () => {
    const unknown = await get("/nope");
    expect(unknown.status).toBe(404);
    expect(unknown.body.available).toContain("cart");
    expect((await get("/broken")).status).toBe(422);
  });

  it("never serves files outside the catalog", async () => {
    // Encoded traversal reaches the catalog and is just an unknown id. (Unencoded
    // "../" is normalized by the client and never reaches the catalog at all.)
    for (const path of ["/..%2F..%2Findex.html", "/%2e%2e%2fnode_modules%2fpkg%2fignored", "/..%2Fe2e%2Fsnapshots%2Fcart"]) {
      const res = await fetch(base + path);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toMatch(/^Unknown scenario/);
    }
  });

  it("is only registered by the dev server", () => {
    expect(typeof warpstate().configureServer).toBe("function");
    expect(warpstate({ scenarios: false }).configureServer).toBeTypeOf("function");
  });
});
