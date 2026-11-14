import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as z from "zod";
import { placeOrder } from "../api";
import { cartTotals, useCart, useCheckout } from "../stores";

const steps = ["shipping", "payment", "review"] as const;

export const Route = createFileRoute("/checkout")({
  validateSearch: z.object({ step: z.enum(steps).catch("shipping") }),
  component: Checkout,
});

function Checkout() {
  const { step } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const goTo = (next: (typeof steps)[number]) => navigate({ search: { step: next } });
  const { shipping, payment, setShipping, setPayment } = useCheckout();
  const { items, coupon, clear } = useCart();
  const { total } = cartTotals(items, coupon);
  const order = useMutation({
    mutationFn: () => placeOrder(total),
    onSuccess: () => {
      clear();
      useCheckout.getState().reset();
    },
  });

  if (order.data) {
    return (
      <section>
        <h1>Thank you!</h1>
        <p data-testid="order-id">Order {order.data.orderId} confirmed.</p>
      </section>
    );
  }

  return (
    <section>
      <h1>Checkout</h1>
      <ol className="steps" aria-label="Checkout steps">
        {steps.map((s) => (
          <li key={s} aria-current={s === step ? "step" : undefined}>
            {s}
          </li>
        ))}
      </ol>

      {step === "shipping" ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setShipping({
              name: String(data.get("name")),
              street: String(data.get("street")),
              city: String(data.get("city")),
            });
            void goTo("payment");
          }}
        >
          <input name="name" defaultValue={shipping.name} placeholder="Full name" aria-label="Full name" required />
          <input name="street" defaultValue={shipping.street} placeholder="Street" aria-label="Street" required />
          <input name="city" defaultValue={shipping.city} placeholder="City" aria-label="City" required />
          <button type="submit">Continue to payment</button>
        </form>
      ) : null}

      {step === "payment" ? (
        <div className="stack">
          {(["card", "pix"] as const).map((method) => (
            <label key={method}>
              <input type="radio" name="payment" checked={payment === method} onChange={() => setPayment(method)} />
              {method === "card" ? "Credit card" : "Pix"}
            </label>
          ))}
          <button type="button" disabled={!payment} onClick={() => void goTo("review")}>
            Review order
          </button>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="stack">
          <p data-testid="ship-to">
            Ship to {shipping.name}, {shipping.street}, {shipping.city}
          </p>
          <p>Pay with {payment === "pix" ? "Pix" : "credit card"}</p>
          <p>
            {items.length} item(s), total <strong data-testid="review-total">${total}</strong>
          </p>
          <button type="button" onClick={() => order.mutate()} disabled={order.isPending}>
            {order.isPending ? "Placing order…" : "Place order"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
