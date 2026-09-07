import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import Header from "./components/Header";
import AuthPage from "./pages/AuthPage";
import AuthFlowPage from "./pages/AuthFlowPage";
import CustomerCollectionPage from "./pages/CustomerCollectionPage";
import DashboardPage from "./pages/DashboardPage";
import ProductsPage from "./pages/ProductsPage";
import RoleWorkspacePage from "./pages/RoleWorkspacePage";
import VendorPage from "./pages/VendorPage";
import ProfilePage from "./pages/ProfilePage";
import AdminCatalogPage from "./pages/AdminCatalogPage";
import ProductDetailPage from "./pages/ProductDetailPage";
import "./App.css";

function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <main className="hero">
      <h1>Everything for your everyday needs.</h1>
      <p>
        ShopSphere connects customers, vendors, delivery personnel, and
        administrators through one secure platform.
      </p>
      <div className="hero-actions">
        <button className="primary" onClick={() => navigate("/products")}>
          Explore products
        </button>
        <button onClick={() => navigate(user ? "/dashboard" : "/register")}>
          {user ? "My dashboard" : "Create account"}
        </button>
      </div>
    </main>
  );
}

function RequireCustomer({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate replace to="/login" />;
  return user.role === "customer" ? (
    children
  ) : (
    <Navigate replace to="/dashboard" />
  );
}

function RequireUser({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate replace to="/login" />;
}

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate replace to="/login" />;
  return roles.includes(user.role) ? (
    children
  ) : (
    <Navigate replace to="/dashboard" />
  );
}

function RequireGuest({ children }) {
  const { user } = useAuth();
  return user ? <Navigate replace to="/dashboard" /> : children;
}

export default function App() {
  const { isLoading, user, sessionError } = useAuth();

  if (isLoading) return <main className="loading">Loading ShopSphere...</main>;

  return (
    <>
      <Header />
      {sessionError && (
        <div className="content error" role="alert">
          {sessionError}{" "}
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/login"
          element={
            <RequireGuest>
              <AuthPage />
            </RequireGuest>
          }
        />
        <Route
          path="/register"
          element={
            <RequireGuest>
              <AuthFlowPage />
            </RequireGuest>
          }
        />
        <Route
          path="/products"
          element={<ProductsPage key={user?.user_id ?? "guest"} />}
        />
        <Route
          path="/cart"
          element={
            <RequireCustomer>
              <CustomerCollectionPage
                key={`cart:${user?.user_id}`}
                type="cart"
              />
            </RequireCustomer>
          }
        />
        <Route
          path="/wishlist"
          element={
            <RequireCustomer>
              <CustomerCollectionPage
                key={`wishlist:${user?.user_id}`}
                type="wishlist"
              />
            </RequireCustomer>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireUser>
              <DashboardPage />
            </RequireUser>
          }
        />
        <Route
          path="/workspace"
          element={
            <RequireUser>
              <RoleWorkspacePage />
            </RequireUser>
          }
        />
        <Route
          path="/vendor/shops"
          element={
            <RequireRole roles={["vendor"]}>
              <VendorPage key="shops" page="shops" />
            </RequireRole>
          }
        />
        <Route
          path="/vendor/inventory"
          element={
            <RequireRole roles={["vendor"]}>
              <VendorPage key="inventory" page="inventory" />
            </RequireRole>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireUser>
              <ProfilePage key={user?.user_id} />
            </RequireUser>
          }
        />
        <Route
          path="/admin/catalog"
          element={
            <RequireRole roles={["admin"]}>
              <AdminCatalogPage />
            </RequireRole>
          }
        />
        <Route
          path="/products/:productId"
          element={<ProductDetailPage key={user?.user_id || "guest"} />}
        />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </>
  );
}
