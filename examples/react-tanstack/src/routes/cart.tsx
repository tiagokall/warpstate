import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { cartTotals, useCart } from "../stores";

export const Route = createFileRoute("/cart")({ component: CartPage });

function CartPage() {
  const { items, coupon, remove, applyCoupon } = useCart();
  const [code, setCode] = useState("");
  const [couponError, setCouponError] = useState(false);
  const { subtotal, discount, total } = cartTotals(items, coupon);

  if (items.length === 0) {
    return (
      <section>
        <h1>Your cart</h1>
        <p>Your cart is empty.</p>
      </section>
    );
  }

  return (
    <section>
      <h1>Your cart</h1>
      <ul className="lines" aria-label="Cart items">
        {items.map((item) => (
          <li key={item.productId}>
            <span>
              {item.qty} × {item.title}
            </span>
            <span>${item.price * item.qty}</span>
            <button type="button" onClick={() => remove(item.productId)} aria-label={`Remove ${item.title}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {coupon ? (
        <p data-testid="coupon">Coupon {coupon} applied</p>
      ) : (
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setCouponError(!applyCoupon(code));
          }}
        >
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Coupon" aria-label="Coupon" />
          <button type="submit">Apply</button>
          {couponError ? <span role="alert">Invalid coupon</span> : null}
        </form>
      )}
      <dl className="totals">
        <dt>Subtotal</dt>
        <dd>${subtotal}</dd>
        <dt>Discount</dt>
        <dd>-${discount}</dd>
        <dt>Total</dt>
        <dd data-testid="total">${total}</dd>
      </dl>
      <Link to="/checkout" search={{ step: "shipping" }} className="cta">
        Checkout
      </Link>
    </section>
  );
}
