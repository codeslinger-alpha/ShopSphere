import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useResource } from "../hooks/useResource";
import ProductCard from "../components/ProductCard";
import ProductMedia from "../components/ProductMedia";
import ActionArt from "../components/ActionArt";
import { categoryArt } from "../components/imagery";

// The landing page reads the same public endpoints the catalog uses. Both are
// optional: if either fails the page still renders its hero and remaining
// sections rather than showing an error.
export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const categories = useResource("/categories");
  const featured = useResource("/products?sort=newest&limit=8");

  // Only top-level categories become tiles; the catalog handles the nesting.
  const topLevel = (categories.data ?? [])
    .filter((category) => category.parent_category === null)
    .slice(0, 8);
  const products = featured.data?.items ?? [];

  // What the marketplace actually does, said four ways. Each card carries its
  // own glyph so the row reads as a set of capabilities rather than four
  // paragraphs of text.
  const highlights = [
    ["search", "Search every shop at once"],
    ["compare", "Compare prices across vendors"],
    ["wishlist", "Track your wishlist"],
    ["orders", "Review what you bought"],
  ];

  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">Marketplace</p>
          <h1>Everything for your everyday needs.</h1>
          <p>
            ShopSphere connects customers, vendors, delivery personnel and
            administrators through one secure platform — one account, one cart,
            every independent shop in the marketplace.
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={() => navigate("/products")}>
              <ActionArt name="products" className="button-art" />
              Explore products
            </button>
            <button onClick={() => navigate(user ? "/dashboard" : "/register")}>
              <ActionArt
                name={user ? "admin" : "user"}
                className="button-art"
              />
              {user ? "My dashboard" : "Create account"}
            </button>
          </div>
        </div>
        <div className="hero-art">
          {highlights.map(([art, label]) => (
            <div className="hero-tile" key={label}>
              <ActionArt name={art} className="hero-tile-art" />
              {label}
            </div>
          ))}
        </div>
      </section>

      {topLevel.length > 0 && (
        <section className="home-section">
          <div className="home-section-head">
            <h2>Shop by category</h2>
            <Link to="/products">Browse everything</Link>
          </div>
          <div className="category-tiles">
            {topLevel.map((category) => (
              <Link
                className="category-tile"
                key={category.category_id}
                to={`/products?category_id=${category.category_id}`}
              >
                {/* Categories carry no image column, so the picture is the drawn
                    illustration chosen from the category's own name — relevant
                    by construction and available offline. */}
                <ProductMedia
                  className="category-image"
                  art={categoryArt(category.name)}
                  alt=""
                />
                <strong>{category.name}</strong>
                {category.description && <span>{category.description}</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {products.length > 0 && (
        <section className="home-section">
          <div className="home-section-head">
            <h2>New in the marketplace</h2>
            <Link to="/products?sort=newest">See all new arrivals</Link>
          </div>
          <div className="product-grid rail">
            {products.map((product) => (
              <ProductCard key={product.prod_id} product={product} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
