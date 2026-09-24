const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
export const SESSION_EXPIRED_EVENT = "shopsphere:session-expired";
// The header shows how many items are in the cart, and it is not the page doing
// the writing. Rather than have every cart button remember to announce itself,
// the announcement is made here, where a cart write can be recognised by its
// path — the same reasoning as the session-expired signal below.
export const CART_CHANGED_EVENT = "shopsphere:cart-changed";

export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "Could not connect to the server. Check your connection and try again.",
    );
  }

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(
      data?.message || `Request failed (HTTP ${response.status}).`,
    );
    error.status = response.status;
    error.data = data;
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      path !== "/auth/register"
    ) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw error;
  }

  // Removing the last cart item answers 204, so this must not be conditional on a
  // response body: the cart changed either way.
  if (isCartWrite(path, options.method)) notifyCartChanged();

  return data;
}

// Placing an order empties the cart, but /orders is not a cart path, so a page
// that changes the cart through something other than /cart says so itself.
export function notifyCartChanged() {
  window.dispatchEvent(new Event(CART_CHANGED_EVENT));
}

function isCartWrite(path, method) {
  return path.startsWith("/cart") && (method || "GET").toUpperCase() !== "GET";
}
