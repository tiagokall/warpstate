import { QueryClient, QueryObserver, dehydrate } from "@tanstack/query-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryAdapter, type WarpQueryState } from "../src";

function seeded() {
  const client = new QueryClient();
  client.setQueryData(["products", { page: 1 }], [{ id: 1, title: "Mug" }]);
  client.setQueryData(["user"], { name: "Ada" });
  return client;
}

afterEach(() => vi.useRealTimers());

describe("queryAdapter", () => {
  it("round-trips the cache into a fresh client", () => {
    const captured = queryAdapter(seeded()).capture();
    const target = new QueryClient();
    queryAdapter(target).restore(JSON.parse(JSON.stringify(captured)));
    expect(target.getQueryData(["products", { page: 1 }])).toEqual([{ id: 1, title: "Mug" }]);
    expect(target.getQueryData(["user"])).toEqual({ name: "Ada" });
    expect(target.getQueryState(["user"])?.status).toBe("success");
    expect(target.getQueryState(["user"])?.fetchStatus).toBe("idle");
  });

  it("captures a compact form much smaller than dehydrate()", () => {
    const client = seeded();
    const compact = JSON.stringify(queryAdapter(client).capture());
    const full = JSON.stringify(dehydrate(client));
    expect(compact.length).toBeLessThan(full.length * 0.6);
    expect(compact).not.toContain("fetchFailureReason");
    expect(compact).not.toContain("queryHash");
  });

  it("can capture the raw dehydrate() output", () => {
    const captured = queryAdapter(seeded(), { compact: false }).capture();
    expect(JSON.stringify(captured)).toContain("queryHash");
    const target = new QueryClient();
    queryAdapter(target).restore(JSON.parse(JSON.stringify(captured)));
    expect(target.getQueryData(["user"])).toEqual({ name: "Ada" });
  });

  it("keeps custom query hashes", () => {
    const client = new QueryClient({ defaultOptions: { queries: { queryKeyHashFn: (key) => `custom:${String(key[0])}` } } });
    client.setQueryData(["user"], 1);
    const captured = queryAdapter(client).capture() as WarpQueryState;
    expect(captured.queries[0]!.queryHash).toBe("custom:user");
    const target = new QueryClient();
    queryAdapter(target).restore(captured);
    expect(target.getQueryCache().get("custom:user")?.state.data).toBe(1);
  });

  it("freshens old data and freezes refetching by default", () => {
    vi.useFakeTimers({ now: new Date("2026-01-01") });
    const captured = queryAdapter(seeded()).capture();
    vi.setSystemTime(new Date("2026-06-01"));
    const target = new QueryClient();
    queryAdapter(target).restore(captured);
    expect(target.getQueryState(["user"])?.dataUpdatedAt).toBe(Date.now());
    const observer = new QueryObserver(target, { queryKey: ["user"] });
    expect(observer.getCurrentResult().isStale).toBe(false);
    expect(target.getDefaultOptions().queries?.retry).toBe(false);
  });

  it("can keep original timestamps and refetch behaviour", () => {
    vi.useFakeTimers({ now: new Date("2026-01-01") });
    const captured = queryAdapter(seeded()).capture();
    vi.setSystemTime(new Date("2026-06-01"));
    const target = new QueryClient();
    queryAdapter(target, { freshen: false, freeze: false }).restore(captured);
    expect(target.getQueryState(["user"])?.dataUpdatedAt).toBe(new Date("2026-01-01").getTime());
    expect(target.getDefaultOptions().queries?.staleTime).toBeUndefined();
  });

  it("uses the reserved name", () => {
    expect(queryAdapter(new QueryClient()).name).toBe("query");
  });
});
