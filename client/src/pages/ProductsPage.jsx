import { useEffect, useRef, useState } from "react";
import { api } from "../api/http";
import { useAuth } from "../auth/useAuth";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";

export default function ProductsPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const requestPending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    api("/products", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setProducts(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function add(path, productId, successMessage) {
    if (requestPending.current) return;
    setError("");
    setMessage("");
    if (user?.role !== "customer") {
      setError("Sign in as a customer to use this feature.");
      return;
    }

    requestPending.current = true;
    setIsAdding(true);
    try {
      const data = await api(path, {
        method: "POST",
        body: JSON.stringify({ prod_id: productId, quantity: 1 }),
      });
      setMessage(data.message || successMessage);
    } catch (error) {
      setError(error.message);
    } finally {
      requestPending.current = false;
      setIsAdding(false);
    }
  }

  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Catalog</p>
          <h1>Find what you need</h1>
        </div>
        <Link to="/">Back home</Link>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {isLoading && <p role="status">Loading products...</p>}
      {!isLoading && !error && products.length === 0 && (
        <p>No products are currently available.</p>
      )}
      <section className="product-grid">
        {products.map((product) => (
          <article className="product-card" key={product.prod_id}>
            {product.images ? (
              <img
                className="product-image"
                src={product.images}
                alt={product.name}
              />
            ) : (
              <div className="image-placeholder">No image</div>
            )}
            <p className="muted">
              {product.manufacturer} · {product.shop_name}
            </p>
            <h2>
              <Link to={`/products/${product.prod_id}`}>{product.name}</Link>
            </h2>
            <Link className="link-button" to={`/products/${product.prod_id}`}>
              Details and reviews
            </Link>
            <div className="markdown">
              <ReactMarkdown>{product.description || ""}</ReactMarkdown>
            </div>
            <strong>${product.unit_price}</strong>
            <span className="muted"> · {product.in_stock} in stock</span>
            {user?.role === "customer" && (
              <div className="card-actions">
                <button
                  className="primary"
                  disabled={isAdding || product.in_stock < 1}
                  onClick={() =>
                    add("/cart", product.prod_id, "Added to your cart.")
                  }
                >
                  {product.in_stock < 1 ? "Out of stock" : "Add to cart"}
                </button>
                <button
                  disabled={isAdding}
                  onClick={() =>
                    add("/wishlist", product.prod_id, "Saved to your wishlist.")
                  }
                >
                  Wishlist
                </button>
              </div>
            )}
            {!user && (
              <Link className="link-button" to="/login">
                Sign in to shop
              </Link>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
