import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  useRouter,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { getWarpGlobal, resetWarp } from "@warpstate/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWarpRouter } from "../src";

let cart = { items: 0 };

// Waiting on the DOM/status (rather than wrapping router promises in act()) works on React 18 and 19.
const waitForReady = () => waitFor(() => expect(getWarpGlobal()?.status).toBe("ready"));
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
    void router.navigate({ to: "/products/$id", params: { id: "3" } });
    await screen.findByText("product 3 with 0 items");
    void router.navigate({ to: "/cart" });
    await screen.findByText("back from cart");
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
    await waitForReady();
    expect(getWarpGlobal()?.status).toBe("ready");
    expect(screen.getByText("back from cart")).toBeTruthy();
    // The router runs on a memory history; the address bar mirrors its route.
    expect(window.location.pathname).toBe("/cart");
  });

  it("keeps mirroring as the app navigates, and can be turned off", async () => {
    const router = createWarpRouter({ routeTree: makeTree(), warp: { adapters: [cartAdapter] } });
    render(<RouterProvider router={router} />);
    await waitForReady();
    router.history.back();
    await screen.findByText(/product 42/);
    expect(window.location.pathname).toBe("/products/42");
    cleanup();

    resetWarp();
    window.history.replaceState(null, "", "/");
    window.__WARPSTATE__ = { snapshot: { warpstate: 1, router: { entries: ["/cart"], index: 0 } } } as never;
    const unmirrored = createWarpRouter({ routeTree: makeTree(), warp: { mirrorUrl: false } });
    render(<RouterProvider router={unmirrored} />);
    await waitForReady();
    expect(window.location.pathname).toBe("/");
  });

  it("keeps ?warp= link params in the mirrored URL so a reload reopens the scenario", async () => {
    (window.__WARPSTATE__ as { keepParams?: string }).keepParams = "warp=cart-scenario";
    const router = createWarpRouter({ routeTree: makeTree(), warp: { adapters: [cartAdapter] } });
    render(<RouterProvider router={router} />);
    await waitForReady();
    expect(window.location.pathname + window.location.search).toBe("/cart?warp=cart-scenario");
  });

  it("restores the back stack", async () => {
    const router = createWarpRouter({ routeTree: makeTree(), warp: { adapters: [cartAdapter] } });
    render(<RouterProvider router={router} />);
    await waitForReady();
    screen.getByText("back from cart").click();
    expect(await screen.findByText("product 42 with 5 items")).toBeTruthy();
    expect(loaderSaw).toEqual([5]);
    expect(getWarpGlobal()!.location!()).toBe("/products/42");
  });

  it("re-captures an equivalent snapshot", async () => {
    const router = createWarpRouter({ routeTree: makeTree(), warp: { adapters: [cartAdapter] } });
    render(<RouterProvider router={router} />);
    await waitForReady();
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
    await waitForReady();
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
