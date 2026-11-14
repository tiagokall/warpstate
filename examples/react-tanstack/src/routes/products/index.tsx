import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import * as z from "zod";
import { productsQuery } from "../../queries";

const searchSchema = z.object({
  q: z.string().catch(""),
  sort: z.enum(["relevance", "price"]).catch("relevance"),
});

export const Route = createFileRoute("/products/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(productsQuery(deps.q, deps.sort)),
  pendingComponent: () => <p className="loading">Loading products…</p>,
  component: Products,
});

function Products() {
  const { q, sort } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: products } = useSuspenseQuery(productsQuery(q, sort));
  return (
    <section>
      <h1>Products</h1>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("q");
          void navigate({ search: (prev) => ({ ...prev, q: String(value ?? "") }) });
        }}
      >
        <input name="q" defaultValue={q} placeholder="Search" aria-label="Search" />
        <select
          aria-label="Sort"
          value={sort}
          onChange={(e) => void navigate({ search: (prev) => ({ ...prev, sort: e.target.value as typeof sort }) })}
        >
          <option value="relevance">Relevance</option>
          <option value="price">Price</option>
        </select>
        <button type="submit">Search</button>
      </form>
      {products.length === 0 ? <p>No products match “{q}”.</p> : null}
      <ul className="grid" aria-label="Product list">
        {products.map((p) => (
          <li key={p.id}>
            <Link to="/products/$productId" params={{ productId: String(p.id) }}>
              <strong>{p.title}</strong>
              <span>${p.price}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
