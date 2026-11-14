import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { WarpProvider } from "@warpstate/react";
import { queryAdapter } from "@warpstate/tanstack-query";
import { createWarpRouter } from "@warpstate/tanstack-router";
import { registerWarpTools } from "@warpstate/webmcp";
import { zustandAdapter } from "@warpstate/zustand";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "./queries";
import { routeTree } from "./routeTree.gen";
import { useCart, useCheckout } from "./stores";
import "./styles.css";

const router = createWarpRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
  warp: {
    app: { name: "warp-shop", schemaVersion: "1" },
    adapters: [queryAdapter(queryClient), zustandAdapter("cart", useCart), zustandAdapter("checkout", useCheckout)],
  },
});

registerWarpTools();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <WarpProvider overlay>
        <RouterProvider router={router} />
      </WarpProvider>
    </QueryClientProvider>
  </StrictMode>,
);
