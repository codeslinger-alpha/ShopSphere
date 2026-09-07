import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { Link, useNavigate } from "react-router-dom";

export default function Header() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);

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
          ShopSphere
        </Link>
        <nav>
          <Link to="/products">Products</Link>
          {user && <Link to="/profile">My profile</Link>}
          {user?.role === "customer" && <Link to="/cart">Cart</Link>}
          {user?.role === "customer" && <Link to="/wishlist">Wishlist</Link>}
          {user?.role === "vendor" && <Link to="/vendor/shops">My shops</Link>}
          {user?.role === "vendor" && (
            <Link to="/vendor/inventory">Buy & list</Link>
          )}
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
              <Link className="primary nav-link" to="/register">
                Sign up
              </Link>
            </>
          )}
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
