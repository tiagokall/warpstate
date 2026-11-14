import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <section>
      <h1>Welcome to Warp Shop</h1>
      <p>An example app for warpstate. Browse around, then press Ctrl+Shift+S to capture a snapshot.</p>
      <Link to="/products" search={{ q: "", sort: "relevance" }}>
        Start shopping →
      </Link>
    </section>
  ),
});
