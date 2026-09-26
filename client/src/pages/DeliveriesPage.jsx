import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/http";
import { useResource, useTask } from "../hooks/useResource";
import { Feedback } from "../components/FormFields";
import OrderStatus from "../components/OrderStatus";

// The courier's run: what they have been asked to carry right now.
//
// Two moves exist and they are strictly ordered — collect the parcel (pending →
// shipped) and hand it over (shipped → delivered). The server refuses anything
// else, and so does the database trigger behind it, so the buttons here offer
// only the move that is legal for each order's current status.
const NEXT_STEP = {
  pending: { label: "Mark collected", status: "shipped" },
  shipped: { label: "Mark delivered", status: "delivered" },
};

// The pickups waiting for a courier: approved returns nobody has collected yet.
//
// This is not restricted to the courier who delivered the order. Whoever is free
// can take it, and the list says who delivered it so a courier can tell at a
// glance whether it is one they already know the address for. A pickup only one
// person can perform is a pickup that can stall forever — which is why the
// server allows any active courier to take one.
function ReturnPickups({ pickups, onCollected }) {
  const task = useTask();

  async function collect(item) {
    const ok = await task.run(() =>
      api(`/delivery/returns/${item.return_id}/collect`, { method: "PUT" }),
    );
    // A collected return leaves the list, so it is re-read rather than patched.
    if (ok) onCollected();
  }

  return (
    <>
      <h2>Returns to collect</h2>
      <Feedback error={task.error} message={task.message} />
      {pickups.isLoading ? (
        <p role="status">Loading pickups...</p>
      ) : pickups.data?.length === 0 ? (
        <div className="empty-state">
          No parcels are waiting to be picked up. A return appears here once the
          shop has accepted it.
        </div>
      ) : (
        <div className="order-list">
          {pickups.data.map((item) => (
            <article className="order-card" key={item.return_id}>
              <div className="order-card-head">
                <div>
                  <h3>
                    {item.listing_name}{" "}
                    <span className="muted">× {item.quantity}</span>
                  </h3>
                  <p className="muted">
                    Return #{item.return_id} · from order #{item.order_id}
                  </p>
                </div>
                <span className={`status-pill status-${item.status}`}>
                  {item.status}
                </span>
              </div>

              <dl className="order-facts">
                <div>
                  <dt>Collect from</dt>
                  <dd>
                    {item.customer_name}
                    {item.customer_phone ? ` · ${item.customer_phone}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>
                    {[
                      item.street_address,
                      item.city,
                      item.state_province,
                      item.postal_code,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </dd>
                </div>
                <div>
                  <dt>Take it back to</dt>
                  <dd>{item.shop_name}</dd>
                </div>
              </dl>

              <p className="muted">
                The customer has already been refunded. Collect the parcel and
                hand it to the shop; nothing is paid at the door.
              </p>

              <button
                className="primary"
                disabled={task.busy}
                onClick={() => collect(item)}
              >
                Mark collected
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export default function DeliveriesPage() {
  const deliveries = useResource("/delivery/deliveries");
  const pickups = useResource("/delivery/returns");
  const task = useTask();
  // Which order the in-flight request belongs to, so only that card's button
  // shows it is working.
  const [pendingId, setPendingId] = useState(null);

  const orders = deliveries.data ?? [];

  async function advance(order, status) {
    setPendingId(order.order_id);
    const ok = await task.run(() =>
      api(`/delivery/orders/${order.order_id}/status`, {
        method: "PUT",
        body: JSON.stringify({ order_status: status }),
      }),
    );
    setPendingId(null);
    // A delivered order leaves the run, so the list is re-read rather than
    // patched: what remains is exactly what the server still considers assigned.
    if (ok) deliveries.reload();
  }

  return (
    <main className="content" aria-busy={deliveries.isLoading || task.busy}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Delivery</p>
          <h1>Current deliveries</h1>
        </div>
        <Link to="/workspace">My availability</Link>
      </div>

      <Feedback error={task.error || deliveries.error} message={task.message} />

      {deliveries.isLoading ? (
        <p role="status">Loading your deliveries...</p>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          Nothing is assigned to you right now. Orders are handed out as they are
          placed, so check back later.
        </div>
      ) : (
        <div className="order-list">
          {orders.map((order) => {
            const next = NEXT_STEP[order.order_status];
            return (
              <article className="order-card" key={order.order_id}>
                <div className="order-card-head">
                  <div>
                    <h2>Order #{order.order_id}</h2>
                    <p className="muted">
                      Placed {new Date(order.created_at).toLocaleString()}
                    </p>
                  </div>
                  <OrderStatus order={order} />
                </div>

                <dl className="order-facts">
                  <div>
                    <dt>Customer</dt>
                    <dd>
                      {order.customer_name}
                      {order.customer_phone ? ` · ${order.customer_phone}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Deliver to</dt>
                    <dd>
                      {[
                        order.street_address,
                        order.city,
                        order.state_province,
                        order.postal_code,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Collect cash</dt>
                    <dd>${order.payment_amount}</dd>
                  </div>
                </dl>

                <ul className="checkout-lines">
                  {(order.items ?? []).map((item) => (
                    <li key={item.prod_id}>
                      <span>
                        {item.name}{" "}
                        <span className="muted">
                          × {item.quantity} · {item.shop_name}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>

                {next ? (
                  <button
                    className="primary"
                    disabled={task.busy}
                    onClick={() => advance(order, next.status)}
                  >
                    {pendingId === order.order_id
                      ? "Saving..."
                      : next.label}
                  </button>
                ) : (
                  <p className="muted">No further action on this order.</p>
                )}
              </article>
            );
          })}
        </div>
      )}

      <ReturnPickups pickups={pickups} onCollected={pickups.reload} />
    </main>
  );
}
