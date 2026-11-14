import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { productQuery } from "../../queries";
import { useCart } from "../../stores";

export const Route = createFileRoute("/products/$productId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(productQuery(Number(params.productId))),
  pendingComponent: () => <p className="loading">Loading product…</p>,
  component: ProductPage,
});

function ProductPage() {
  const { productId } = Route.useParams();
  const { data: product } = useSuspenseQuery(productQuery(Number(productId)));
  const add = useCart((s) => s.add);
  const inCart = useCart((s) => s.items.find((i) => i.productId === product.id)?.qty ?? 0);
  return (
    <section>
      <h1>{product.title}</h1>
      <p>{product.description}</p>
      <p className="price">${product.price}</p>
      <button type="button" onClick={() => add(product)}>
        Add to cart
      </button>
      {inCart ? <p data-testid="in-cart">{inCart} in cart</p> : null}
    </section>
  );
}
