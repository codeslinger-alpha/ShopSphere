import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import Header from "./components/Header";
import Footer from "./components/Footer";
import AuthPage from "./pages/AuthPage";
import AuthFlowPage from "./pages/AuthFlowPage";
import CustomerCollectionPage from "./pages/CustomerCollectionPage";
import DashboardPage from "./pages/DashboardPage";
import HomePage from "./pages/HomePage";
import ProductsPage from "./pages/ProductsPage";
import RoleWorkspacePage from "./pages/RoleWorkspacePage";
import VendorPage from "./pages/VendorPage";
import ProfilePage from "./pages/ProfilePage";
import AdminCatalogPage from "./pages/AdminCatalogPage";
import AdminConsolePage from "./pages/AdminConsolePage";
import ProductDetailPage from "./pages/ProductDetailPage";
import CheckoutPage from "./pages/CheckoutPage";
import OrdersPage from "./pages/OrdersPage";
import OrderDetailPage from "./pages/OrderDetailPage";
import AccountPaymentsPage from "./pages/AccountPaymentsPage";
import DeliveriesPage from "./pages/DeliveriesPage";
import "./App.css";

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
        <Route path="/" element={<HomePage />} />
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
          path="/checkout"
          element={
            <RequireRole roles={["customer"]}>
              <CheckoutPage key={`checkout:${user?.user_id}`} />
            </RequireRole>
          }
        />
        <Route
          path="/orders"
          element={
            <RequireRole roles={["customer"]}>
              <OrdersPage key={`orders:${user?.user_id}`} />
            </RequireRole>
          }
        />
        <Route
          path="/orders/:orderId"
          element={
            <RequireRole roles={["customer"]}>
              <OrderDetailPage key={user?.user_id} />
            </RequireRole>
          }
        />
        <Route
          path="/account/payments"
          element={
            <RequireRole roles={["customer"]}>
              <AccountPaymentsPage key={user?.user_id} />
            </RequireRole>
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
            <RequireRole roles={["delivery"]}>
              <RoleWorkspacePage />
            </RequireRole>
          }
        />
        <Route
          path="/delivery/deliveries"
          element={
            <RequireRole roles={["delivery"]}>
              <DeliveriesPage key={user?.user_id} />
            </RequireRole>
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
          path="/vendor/payments"
          element={
            <RequireRole roles={["vendor"]}>
              <VendorPage key="payments" page="payments" />
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
          path="/admin"
          element={
            <RequireRole roles={["admin"]}>
              <AdminConsolePage />
            </RequireRole>
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
      <Footer />
    </>
  );
}
