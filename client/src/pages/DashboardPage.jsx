import { useAuth } from "../auth/useAuth";
import { Link } from "react-router-dom";
import ActionArt from "../components/ActionArt";

// Which glyph each destination gets, keyed by route rather than carried in the
// tuples above: the label list stays a plain label list, and a new destination
// with no entry here falls back to the generic bag rather than rendering blank.
const ART_BY_PATH = {
  "/products": "products",
  "/cart": "cart",
  "/wishlist": "wishlist",
  "/orders": "orders",
  "/account/payments": "cart",
  "/vendor/shops": "vendor",
  "/vendor/inventory": "products",
  "/vendor/payments": "cart",
  "/workspace": "delivery",
  "/delivery/deliveries": "delivery",
  "/admin": "admin",
  "/admin/catalog": "products",
};

const roleContent = {
  customer: [
    ["Browse products", "/products"],
    ["Manage cart", "/cart"],
    ["Manage wishlist", "/wishlist"],
    ["My orders", "/orders"],
    ["Payment history", "/account/payments"],
  ],
  vendor: [
    ["Manage my shop", "/vendor/shops"],
    ["Buy and list products", "/vendor/inventory"],
    ["Payments", "/vendor/payments"],
  ],
  delivery: [
    ["Update availability", "/workspace"],
    ["Current deliveries", "/delivery/deliveries"],
  ],
  admin: [
    ["Administration console", "/admin"],
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
        {(roleContent[user.role] || []).map(([label, path]) => (
          <Link className="dashboard-link" key={path} to={path}>
            {/* The glyph is chosen from the destination, so the tiles read as a
                set of actions rather than as a list of links. */}
            <ActionArt
              name={ART_BY_PATH[path] ?? "products"}
              className="dashboard-link-art"
            />
            {label}
          </Link>
        ))}
      </section>
    </main>
  );
}
