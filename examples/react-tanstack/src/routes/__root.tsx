import type { QueryClient } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext, useRouter } from "@tanstack/react-router";
import { useCart } from "../stores";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

function RootLayout() {
  const router = useRouter();
  const count = useCart((s) => s.items.reduce((n, i) => n + i.qty, 0));
  return (
    <div className="shell">
      <header>
        <button type="button" className="back" onClick={() => router.history.back()} aria-label="Back">
          ← Back
        </button>
        <Link to="/" className="brand">
          Warp Shop
        </Link>
        <nav>
          <Link to="/products" search={{ q: "", sort: "relevance" }}>
            Products
          </Link>
          <Link to="/cart" data-testid="cart-link">
            Cart ({count})
          </Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
