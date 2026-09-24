import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, notifyCartChanged } from "../api/http";
import { useResource, useTask } from "../hooks/useResource";
import { AddressFields, Feedback } from "../components/FormFields";

// Placing the order, in cash on delivery.
//
// The cart is the order: this page shows what is in it and asks only where to
// send it. Nothing here reserves stock — the order either claims every line
// outright or is refused whole, so a shortage comes back as a message naming the
// listing, not as a half-placed order.
export default function CheckoutPage() {
  const navigate = useNavigate();
  const task = useTask();
  const cart = useResource("/cart");
  const profile = useResource("/profile");
  const [useOwnAddress, setUseOwnAddress] = useState(false);
  // useTask reports only whether the action succeeded, so the created order is
  // kept here for the navigation that follows.
  const placed = useRef(null);

  const items = cart.data ?? [];
  const total = items.reduce((sum, item) => sum + Number(item.subtotal), 0);

  async function placeOrder(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    // The address fields are only rendered once the customer opts into entering
    // one, so an empty payload is not a mistake: it means "use my profile
    // address", which is what the server falls back to.
    const payload = useOwnAddress
      ? {
          street_address: body.street_address,
          city: body.city,
          postal_code: body.postal_code,
          state_province: body.state_province,
          country_id: body.country_id,
        }
      : {};

    const ok = await task.run(async () => {
      const data = await api("/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      placed.current = data.order;
      return data;
    });
    if (!ok || !placed.current) return;

    // Placing the order emptied the cart, and /orders is not a cart path, so the
    // header's badge has to be told rather than noticing.
    notifyCartChanged();
    navigate(`/orders/${placed.current.order_id}`, {
      state: { justPlaced: true },
    });
  }

  return (
    <main className="content narrow" aria-busy={cart.isLoading || task.busy}>
      <div className="page-heading">
        <h1>Checkout</h1>
        <Link to="/cart">Back to cart</Link>
      </div>

      <Feedback error={task.error || cart.error} />

      {cart.isLoading && <p role="status">Loading your cart...</p>}

      {!cart.isLoading && items.length === 0 && (
        <div className="empty-state">
          Your cart is empty, so there is nothing to order.{" "}
          <Link to="/products">Browse products</Link>
        </div>
      )}

      {!cart.isLoading && items.length > 0 && (
        <>
          <section className="panel">
            <h2>Your order</h2>
            <ul className="checkout-lines">
              {items.map((item) => (
                <li key={item.prod_id}>
                  <span>
                    {item.name} <span className="muted">× {item.quantity}</span>
                  </span>
                  <span>${item.subtotal}</span>
                </li>
              ))}
            </ul>
            <p className="cart-total">
              Total: <strong>${total.toFixed(2)}</strong>
            </p>
            <p className="muted">
              Delivery is free. Pay ${total.toFixed(2)} in cash when the order
              arrives.
            </p>
          </section>

          <form className="panel form" onSubmit={placeOrder}>
            <h2>Delivery address</h2>
            <p className="muted">
              {profile.data?.street_address
                ? `By default this goes to your profile address: ${[
                    profile.data.street_address,
                    profile.data.city,
                  ]
                    .filter(Boolean)
                    .join(", ")}.`
                : "By default this goes to the address on your profile."}
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={useOwnAddress}
                onChange={(event) => setUseOwnAddress(event.target.checked)}
              />
              Send this order to a different address
            </label>

            {useOwnAddress && <AddressFields />}

            <button className="primary" disabled={task.busy}>
              {task.busy
                ? "Placing your order..."
                : "Place order (cash on delivery)"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
