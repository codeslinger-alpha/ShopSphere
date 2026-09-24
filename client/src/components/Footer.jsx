import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

// Links point only at routes that exist. The brand is deliberately plain text
// rather than a link, so the header's "ShopSphere" link stays the only one.
export default function Footer() {
  const { user } = useAuth();

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div>
          <p className="footer-brand">
            {/* The same file the header and the browser tab use. The mark carries
                its own green field, so it needs no tint of its own here — and a
                text "S" beside it would be a second mark for one brand. */}
            <img
              className="brand-mark"
              src="/favicon.svg"
              alt=""
              aria-hidden="true"
            />
            ShopSphere
          </p>
          <p className="footer-tagline">
            One marketplace connecting customers, independent vendors, delivery
            personnel and administrators.
          </p>
        </div>

        <div>
          <h2>Shop</h2>
          <ul>
            <li>
              <Link to="/products">All products</Link>
            </li>
            <li>
              <Link to="/products?sort=newest">New arrivals</Link>
            </li>
            <li>
              <Link to="/products?sort=price_asc">Best prices</Link>
            </li>
          </ul>
        </div>

        <div>
          <h2>Account</h2>
          <ul>
            {user ? (
              <>
                <li>
                  <Link to="/dashboard">Dashboard</Link>
                </li>
                <li>
                  <Link to="/profile">Account settings</Link>
                </li>
              </>
            ) : (
              <>
                <li>
                  <Link to="/login">Sign in</Link>
                </li>
                <li>
                  <Link to="/register">Create an account</Link>
                </li>
              </>
            )}
          </ul>
        </div>

        <div>
          <h2>Selling</h2>
          <ul>
            {user?.role === "vendor" ? (
              <>
                <li>
                  <Link to="/vendor/shops">My shops</Link>
                </li>
                <li>
                  <Link to="/vendor/inventory">Buy &amp; list</Link>
                </li>
              </>
            ) : (
              <li>
                <Link to="/register">Open a shop</Link>
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="site-footer-inner footer-legal">
        <span>© {new Date().getFullYear()} ShopSphere. A demonstration marketplace.</span>
        <span>Built with React, Express and PostgreSQL.</span>
      </div>
    </footer>
  );
}
