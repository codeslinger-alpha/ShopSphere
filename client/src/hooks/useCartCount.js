import { useEffect, useState } from "react";
import { api, CART_CHANGED_EVENT } from "../api/http";

// How many items are in the customer's cart, for the header badge.
//
// Read here rather than lifted into the auth context: the cart is one number in
// one place, and a context would make every page re-render on a cart change to
// serve a badge. The event is the same window-event idiom the session-expired
// signal uses.
export function useCartCount(user) {
  const isCustomer = user?.role === "customer";
  // Only a customer has a cart, so anyone else is tracked as having none — which
  // also means signing out drops the badge without a request to fail.
  const userId = isCustomer ? user.user_id : null;
  const [cart, setCart] = useState({ userId: null, count: 0 });

  useEffect(() => {
    if (userId === null) return;

    let pending;
    function read() {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      api("/cart", { signal: controller.signal })
        .then((items) => {
          if (!controller.signal.aborted)
            setCart({
              userId,
              count: items.reduce((n, item) => n + item.quantity, 0),
            });
        })
        // A badge is not worth an error banner; the cart page reports its own
        // failures, and a stale number is the worst this can do.
        .catch(() => {});
    }

    read();
    window.addEventListener(CART_CHANGED_EVENT, read);
    return () => {
      pending?.abort();
      window.removeEventListener(CART_CHANGED_EVENT, read);
    };
  }, [userId]);

  return cart.userId === userId ? cart.count : 0;
}
