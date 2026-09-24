import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/http";
import CartQuantityForm from "../components/CartQuantityForm";

export default function CustomerCollectionPage({ type }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestPending = useRef(false);
  const isCart = type === "cart";

  useEffect(() => {
    const controller = new AbortController();
    api(`/${type}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setItems(data);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [type, retry]);

  async function changeItem(productId, quantity) {
    // Block overlapping writes, including a Remove click during an Update.
    if (requestPending.current) return false;
    requestPending.current = true;
    setIsSaving(true);
    setError("");
    setMessage("");
    const removing = quantity === undefined;
    try {
      const data = await api(
        `/${type}/${productId}`,
        removing
          ? { method: "DELETE" }
          : { method: "PUT", body: JSON.stringify({ quantity }) },
      );
      setItems((current) =>
        removing
          ? current.filter((item) => item.prod_id !== productId)
          : current.map((item) =>
              item.prod_id === productId ? data.item : item,
            ),
      );
      setMessage(removing ? "Item removed." : "Cart quantity updated.");
      return true;
    } catch (requestError) {
      // A stock change returns both the current stock and saved quantity.
      if (requestError.data?.item) {
        setItems((current) =>
          current.map((item) =>
            item.prod_id === productId ? requestError.data.item : item,
          ),
        );
      } else if (requestError.status === 404) {
        setItems((current) =>
          current.filter((item) => item.prod_id !== productId),
        );
      }
      setError(requestError.message);
      return false;
    } finally {
      requestPending.current = false;
      setIsSaving(false);
    }
  }

  function reload() {
    setError("");
    setMessage("");
    setIsLoading(true);
    setRetry((current) => current + 1);
  }

  // Only the cart has prices to total; a wishlist row carries no subtotal.
  const total = isCart
    ? items.reduce((sum, item) => sum + Number(item.subtotal), 0)
    : 0;
  const blocked =
    isCart && items.some((item) => !item.available || item.quantity > item.in_stock);

  return (
    <main className="content narrow" aria-busy={isLoading || isSaving}>
      <div className="page-heading">
        <h1>{isCart ? "My cart" : "My wishlist"}</h1>
        <Link to="/products">Browse products</Link>
      </div>
      {isCart && (
        <p className="muted">
          Choose a quantity, then press Update to save it. Stock is claimed when
          you place the order, not while it sits in your cart.
        </p>
      )}
      {error && (
        <div role="alert">
          <p className="error">{error}</p>
          <button disabled={isLoading || isSaving} onClick={reload}>
            Refresh items
          </button>
        </div>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {isLoading ? (
        <p role="status">Loading your {type}...</p>
      ) : (
        <>
          {!error && items.length === 0 && (
            <div className="empty-state">Your {type} is empty.</div>
          )}
          {items.map((item) => (
            <article className="collection-row" key={item.prod_id}>
              <div>
                <h2>{item.name}</h2>
                <p>
                  {item.shop_name} · ${item.unit_price}
                </p>
                <p>
                  {item.available
                    ? `${item.in_stock} in stock`
                    : "Currently unavailable"}
                </p>
                {isCart && (
                  <p>
                    Saved quantity: {item.quantity} · Subtotal: ${item.subtotal}
                  </p>
                )}
                {isCart && item.quantity > item.in_stock && (
                  <p className="error">
                    Stock has changed. Reduce the quantity or remove this item.
                  </p>
                )}
              </div>
              <div className="row-actions">
                {isCart && item.available && (
                  <CartQuantityForm
                    key={`${item.prod_id}:${item.quantity}:${item.in_stock}`}
                    item={item}
                    disabled={isSaving}
                    onUpdate={changeItem}
                  />
                )}
                <button
                  disabled={isSaving}
                  onClick={() => changeItem(item.prod_id)}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}

          {/* Checkout needs every line to be buyable: the server refuses the
              whole order if any one of them is short, so sending the customer
              there with a broken line would only waste the trip. */}
          {isCart && items.length > 0 && (
            <section className="cart-summary">
              <div>
                <p className="cart-total">
                  Order total: <strong>${total.toFixed(2)}</strong>
                </p>
                {blocked ? (
                  <p className="error">
                    Some items are unavailable or exceed the stock. Adjust or
                    remove them before checking out.
                  </p>
                ) : (
                  <p className="muted">
                    Pay in cash when the order arrives. Stock is claimed when you
                    place the order.
                  </p>
                )}
              </div>
              {blocked ? (
                <button disabled>Proceed to checkout</button>
              ) : (
                <Link className="button primary" to="/checkout">
                  Proceed to checkout
                </Link>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
