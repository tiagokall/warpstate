import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  useRouter,
} from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { getWarpGlobal, resetWarp } from "@warpstate/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWarpRouter } from "../src";

let cart = { items: 0 };
const loaderSaw: number[] = [];

function makeTree() {
  const root = createRootRoute({ component: () => <Outlet /> });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <h1>home</h1> });
  const products = createRoute({
    getParentRoute: () => root,
    path: "/products/$id",
    loader: () => {
      loaderSaw.push(cart.items);
      return { items: cart.items };
    },
    component: function Product() {
      const { id } = products.useParams();
      const { items } = products.useLoaderData();
      return (
        <h1>
          product {id} with {items} items
        </h1>
      );
    },
  });
  const cartRoute = createRoute({
    getParentRoute: () => root,
    path: "/cart",
    component: function Cart() {
      const router = useRouter();
      return <button onClick={() => router.history.back()}>back from cart</button>;
    },
  });
  return root.addChildren([home, products, cartRoute]);
}

const cartAdapter = {
  name: "cart",
  capture: () => cart,
  restore: (data: typeof cart) => void (cart = data),
};

beforeEach(() => {
  resetWarp();
  sessionStorage.clear();
  cart = { items: 0 };
  loaderSaw.length = 0;
  window.history.replaceState(null, "", "/");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("createWarpRouter without a snapshot", () => {
  it("behaves like createRouter with browser history", async () => {
    window.history.replaceState(null, "", "/products/7");
    const router = createWarpRouter({ routeTree: makeTree(), warp: { adapters: [cartAdapter] } });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("product 7 with 0 items")).toBeTruthy();
    expect(getWarpGlobal()?.status).toBe("idle");
    expect(router.history.location.href).toBe("/products/7");
  });

  it("captures the visited history stack", async () => {
    const router = createWarpRouter({ routeTree: makeTree() });
    render(<RouterProvider router={router} />);
    await screen.findByText("home");
    await act(() => router.navigate({ to: "/products/$id", params: { id: "3" } }));
    await act(() => router.navigate({ to: "/cart" }));
    router.history.flush();
    const snapshot = getWarpGlobal()!.capture!();
    expect(snapshot.router).toEqual({ entries: ["/", "/products/3", "/cart"], index: 2 });
  });
});

describe("createWarpRouter with a snapshot", () => {
  beforeEach(() => {
    window.__WARPSTATE__ = {
      snapshot: {
        warpstate: 1,
        router: { entries: ["/", "/products/42", "/cart"], index: 2 },
        stores: { cart: { items: 5 } },
      },
    } as never;
  });

  it("renders the snapshot route with restored state and resolves ready", async () => {
    const router = createWarpRouter({ routeTree: makeTree(), warp: { adapters: [cartAdapter] } });
    expect(cart).toEqual({ items: 5 }); // restored before the router exists
    render(<RouterProvider router={router} />);
    await act(() => getWarpGlobal()!.ready);
    expect(getWarpGlobal()?.status).toBe("ready");
    expect(screen.getByText("back from cart")).toBeTruthy();
    expect(window.location.pathname).toBe("/"); // the browser URL is untouched
  });

  it("restores the back stack", async () => {
    const router = createWarpRouter({ routeTree: makeTree(), warp: { adapters: [cartAdapter] } });
    render(<RouterProvider router={router} />);
    await act(() => getWarpGlobal()!.ready);
    act(() => screen.getByText("back from cart").click());
    expect(await screen.findByText("product 42 with 5 items")).toBeTruthy();
    expect(loaderSaw).toEqual([5]);
    expect(getWarpGlobal()!.location!()).toBe("/products/42");
  });

  it("re-captures an equivalent snapshot", async () => {
    const router = createWarpRouter({ routeTree: makeTree(), warp: { adapters: [cartAdapter] } });
    render(<RouterProvider router={router} />);
    await act(() => getWarpGlobal()!.ready);
    const captured = getWarpGlobal()!.capture!();
    expect(captured.router).toEqual({ entries: ["/", "/products/42", "/cart"], index: 2 });
    expect(captured.stores).toEqual({ cart: { items: 5 } });
  });

  it("supports snapshots positioned on the first entry", async () => {
    window.__WARPSTATE__ = {
      snapshot: { warpstate: 1, router: { entries: ["/products/1", "/cart"], index: 0 } },
    } as never;
    const router = createWarpRouter({ routeTree: makeTree() });
    render(<RouterProvider router={router} />);
    await act(() => getWarpGlobal()!.ready);
    expect(screen.getByText("product 1 with 0 items")).toBeTruthy();
  });

  it("ignores a custom history while warping", () => {
    const router = createWarpRouter({
      routeTree: makeTree(),
      history: createMemoryHistory({ initialEntries: ["/ignored"] }),
    });
    expect(router.history.location.href).toBe("/cart");
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/Ignoring the `history` option/));
  });
});
