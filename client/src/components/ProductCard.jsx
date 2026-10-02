import { Link } from "react-router-dom";
import ProductMedia from "./ProductMedia";
import { categoryArt } from "./imagery";

// One card for every listing surface. The landing page links out only; the
// catalog passes onAdd so customers can add straight to a collection.
export default function ProductCard({
  product,
  onAdd,
  isAdding,
  actionLabel,
  wishlistLabel = "Wishlist",
}) {
  const outOfStock = product.in_stock < 1;
    const reviewCount = Number(product.review_count ?? 0);

  return (
    <article className="product-card">
      <Link
        className="product-media"
        to={`/products/${product.prod_id}`}
        tabIndex={-1}
        aria-hidden="true"
      >
        {/* The category name is passed as well as the product name: the product
            name picks the photo, and the category decides what to show when
            there is no photo for it. */}
        <ProductMedia
          src={product.images}
          name={product.name}
          art={categoryArt(product.category_name)}
        />
        {outOfStock && <span className="badge">Out of stock</span>}
      </Link>
      <div className="product-body">
        <p className="product-meta">
          {[product.manufacturer, product.shop_name].filter(Boolean).join(" · ")}
        </p>
        <h2 className="product-title">
          <Link to={`/products/${product.prod_id}`}>{product.name}</Link>
        </h2>
        {product.category_id && (
          <p className="product-meta">
            <Link to={`/products?category_id=${product.category_id}`}>
              {product.category_name}
            </Link>
          </p>
        )}
        <p className="product-price">${product.unit_price}</p>
        <p className={outOfStock ? "product-stock out" : "product-stock"}>
          {outOfStock ? "Currently unavailable" : `${product.in_stock} in stock`}
        </p>
        <p className="product-meta">
          {reviewCount > 0
            ? `${Number(product.average_rating).toFixed(1)}/5 · ${reviewCount} review${reviewCount === 1 ? "" : "s"}`
            : "No reviews yet"}
        </p>
        <Link className="link-button" to={`/products/${product.prod_id}`}>
          Details and reviews
        </Link>
        {onAdd && (
          <div className="card-actions">
            <button
              className="primary"
              disabled={isAdding || outOfStock}
              onClick={() => onAdd("/cart", product.prod_id, "Added to your cart.")}
            >
              {outOfStock ? "Out of stock" : (actionLabel ?? "Add to cart")}
            </button>
            <button
              disabled={isAdding}
              onClick={() =>
                onAdd("/wishlist", product.prod_id, "Saved to your wishlist.")
              }
            >
              {wishlistLabel}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
