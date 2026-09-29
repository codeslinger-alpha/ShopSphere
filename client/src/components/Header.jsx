import { useState } from "react";
import Avatar from "./Avatar";
import { useAuth } from "../auth/useAuth";
import { useCartCount } from "../hooks/useCartCount";
import { useTheme } from "../hooks/useTheme";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

function SearchIcon() {
  return (
    <svg
      className="header-search-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

// The toggle shows the theme it switches *to*, which is the reading people
// expect from a sun/moon button. The accessible name says so in words, so the
// control is not a mystery to a screen reader.
function ThemeIcon({ theme }) {
  return theme === "dark" ? (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" />
    </svg>
  ) : (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8z" />
    </svg>
  );
}

export default function Header() {
  const { logout, user } = useAuth();
  const cartCount = useCartCount(user);
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);
  // Keep the field in step with the URL, so a footer or category link that
  // changes the search term does not leave a stale value in the box, and a
  // deep link into /products?q=... starts out populated. Adjusted during render
  // rather than in an effect — an effect would paint the stale value first and
  // then re-render.
  const urlTerm =
    location.pathname === "/products" ? (searchParams.get("q") ?? "") : "";
  const [term, setTerm] = useState(urlTerm);
  const [syncedTerm, setSyncedTerm] = useState(urlTerm);
  if (urlTerm !== syncedTerm) {
    setSyncedTerm(urlTerm);
    setTerm(urlTerm);
  }

  function handleSearch(event) {
    event.preventDefault();
    const query = term.trim();
    navigate(query ? `/products?q=${encodeURIComponent(query)}` : "/products");
  }

  async function handleLogout() {
    setError("");
    setIsSigningOut(true);
    try {
      await logout();
      navigate("/");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <>
      <header className="site-header">
        <Link className="brand" to="/">
          {/* The favicon is already the brand mark; drawing a second "S" in text
              beside it would be two marks for one brand. Hidden from assistive
              tech so the link's name stays "ShopSphere". */}
          <img
            className="brand-mark"
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
          />
          ShopSphere
        </Link>

        <form className="header-search" role="search" onSubmit={handleSearch}>
          <label className="visually-hidden" htmlFor="header-search-input">
            Search products
          </label>
          <SearchIcon />
          <input
            id="header-search-input"
            type="search"
            value={term}
            placeholder="Search products, brands and categories"
            onChange={(event) => setTerm(event.target.value)}
          />
        </form>

        <nav>
          {/* No "Products" link: the catalog is the landing page's first call to
              action, it is in every category tile, and the search box above
              submits straight to it. A nav entry only restated the search field
              that sits beside it. */}
          {user && <Link to="/profile" className="account-link">
            <Avatar key={user.pfp} name={user.name} src={user.pfp} decorative />
            Account settings
          </Link>}
          {user?.role === "customer" && (
            <Link to="/cart">
              Cart
              {/* The count is the point: without it the cart is reachable but
                  gives no sign that anything is waiting in it. */}
              {cartCount > 0 && (
                <span className="cart-count">
                  <span className="visually-hidden">, </span>
                  {cartCount}
                  <span className="visually-hidden"> items</span>
                </span>
              )}
            </Link>
          )}
          {user?.role === "customer" && <Link to="/orders">My orders</Link>}
          {user?.role === "customer" && <Link to="/wishlist">Wishlist</Link>}
          {user?.role === "vendor" && <Link to="/vendor/shops">My shops</Link>}
          {user?.role === "vendor" && (
            <Link to="/vendor/inventory">Buy &amp; list</Link>
          )}
          {user?.role === "delivery" && (
            <Link to="/delivery/deliveries">Current deliveries</Link>
          )}
          {user?.role === "admin" && <Link to="/admin">Admin</Link>}
          {user ? (
            <>
              <Link to="/dashboard">Dashboard</Link>
              <button disabled={isSigningOut} onClick={handleLogout}>
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link className="primary" to="/register">
                Sign up
              </Link>
            </>
          )}
          <button
            type="button"
            className="theme-toggle"
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            <ThemeIcon theme={theme} />
          </button>
        </nav>
      </header>
      {error && (
        <p className="content error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
