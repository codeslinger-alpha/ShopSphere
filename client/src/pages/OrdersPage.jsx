import { Link } from "react-router-dom";
import { useResource } from "../hooks/useResource";
import { Feedback } from "../components/FormFields";
import OrderStatus from "../components/OrderStatus";

// The customer's own order history. One order per row, newest first, with the
// two things worth knowing at a glance: where the order is, and whether the cash
// has been handed over.
export default function OrdersPage() {
  const orders = useResource("/orders");
  const items = orders.data ?? [];

  return (
    <main className="content" aria-busy={orders.isLoading}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Purchases</p>
          <h1>My orders</h1>
        </div>
        <Link to="/products">Browse products</Link>
      </div>

      <Feedback error={orders.error} />

      {orders.isLoading ? (
        <p role="status">Loading your orders...</p>
      ) : items.length === 0 ? (
        <div className="empty-state">
          You have not placed an order yet.{" "}
          <Link to="/products">Find something to order</Link>
        </div>
      ) : (
        <div className="order-list">
          {items.map((order) => (
            <article className="order-card" key={order.order_id}>
              <div className="order-card-head">
                <div>
                  <h2>
                    <Link to={`/orders/${order.order_id}`}>
                      Order #{order.order_id}
                    </Link>
                  </h2>
                  <p className="muted">
                    Placed {new Date(order.created_at).toLocaleString()}
                  </p>
                </div>
                <OrderStatus order={order} />
              </div>
              <p>
                {order.item_quantity} item
                {order.item_quantity === 1 ? "" : "s"} from {order.item_count}{" "}
                listing{order.item_count === 1 ? "" : "s"} · $
                {order.total_amount}
              </p>
              <p className="muted">
                To {order.street_address}, {order.city}
              </p>
              <p className="muted">
                {order.delivery_person_name
                  ? `Courier: ${order.delivery_person_name}`
                  : "Waiting for a courier"}
              </p>
              <Link className="link-button" to={`/orders/${order.order_id}`}>
                View order details
              </Link>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
