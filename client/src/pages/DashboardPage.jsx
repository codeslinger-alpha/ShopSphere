import { useAuth } from "../auth/useAuth";
import { Link } from "react-router-dom";

const roleContent = {
  customer: [
    ["Browse products", "/products"],
    ["Manage cart", "/cart"],
    ["Manage wishlist", "/wishlist"],
  ],
  vendor: [
    ["Manage my shop", "/vendor/shops"],
    ["Buy and list products", "/vendor/inventory"],
  ],
  delivery: [["Update availability", "/workspace"]],
  admin: [
    ["Manage users", "/workspace"],
    ["Manage catalog", "/admin/catalog"],
  ],
};

export default function DashboardPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <main className="content">
        <p className="error">Please sign in first.</p>
      </main>
    );
  }

  return (
    <main className="content">
      <p className="eyebrow">{user.role} dashboard</p>
      <h1>Hello, {user.name}</h1>
      <p className="muted">
        Your role determines which server-side features you can access.
      </p>
      <section className="dashboard-grid">
        <Link className="dashboard-link" to="/profile">
          Complete my profile
        </Link>
        {(roleContent[user.role] || []).map(([label, path]) => (
          <Link className="dashboard-link" key={path} to={path}>
            {label}
          </Link>
        ))}
      </section>
    </main>
  );
}
