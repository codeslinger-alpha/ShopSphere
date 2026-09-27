import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../api/http";
import { useResource, useTask } from "../hooks/useResource";
import { Feedback } from "../components/FormFields";
import OrderStatus from "../components/OrderStatus";
import StarRating from "../components/StarRating";

// A shop's reviews, and the form for adding one, for one shop this order bought
// from.
//
// The values in the form are held in `mine` rather than read straight from the
// eligibility check, because reloading that check clears its data for a moment
// and an uncontrolled field would keep showing the old text anyway. `mine` is
// resynced only when the fetched review is a different one — by `last_modified`,
// which the table's trigger restamps on every write — so a reload never blanks
// the form under the customer's hands.
function ShopReviews({ shopId, shopName }) {
  const reviews = useResource(`/shops/${shopId}/reviews`);
  const eligibility = useResource(`/shops/${shopId}/review-eligibility`);
  const task = useTask();
  const [mine, setMine] = useState(null);
  const [synced, setSynced] = useState(undefined);

  const fetched = eligibility.data?.review ?? null;
  if (eligibility.data && fetched?.last_modified !== synced) {
    setSynced(fetched?.last_modified);
    setMine(fetched);
  }

  const list = reviews.data ?? [];
  const average = list.length
    ? list.reduce((sum, review) => sum + review.rating, 0) / list.length
    : null;

  async function save(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const ok = await task.run(() =>
      api(`/shops/${shopId}/review`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    );
    if (ok) {
      reviews.reload();
      eligibility.reload();
    }
  }

  async function remove() {
    const ok = await task.run(() =>
      api(`/shops/${shopId}/review`, { method: "DELETE" }),
    );
    if (ok) {
      reviews.reload();
      eligibility.reload();
    }
  }

  return (
    <section className="panel">
      <h2>{shopName}</h2>
      <Feedback
        error={task.error || reviews.error || eligibility.error}
        message={task.message}
      />

      {average !== null && (
        <p className="review-average">
          <StarRating readOnly value={Math.round(average)} />
          <span className="muted">
            {average.toFixed(1)} from {list.length} review
            {list.length === 1 ? "" : "s"}
          </span>
        </p>
      )}

      {list.length === 0 ? (
        <p className="empty-state">Nobody has reviewed this shop yet.</p>
      ) : (
        list.map((review) => (
          <article className="shop-review" key={review.user_id}>
            <strong>{review.name}</strong>
            <StarRating readOnly value={review.rating} />
            <p className="review-text">{review.review}</p>
          </article>
        ))
      )}

      {/* Only a customer with a delivered order from this shop can post, which
          is the rule the database enforces too. The server answers the question
          rather than the page guessing from this order's status: a customer who
          bought here last month may rate the shop without buying again. */}
      {eligibility.data?.eligible && (
        <form
          className="review-form"
          key={mine?.last_modified ?? "new"}
          onSubmit={save}
        >
          <h3>{mine ? "Update your review" : "Rate this shop"}</h3>
          <div className="star-rating-field">
            <span className="star-rating-label">Rating</span>
            <StarRating defaultValue={mine?.rating || 5} />
          </div>
          <label>
            Review
            <textarea
              name="review"
              rows="4"
              maxLength="10000"
              defaultValue={mine?.review || ""}
              placeholder="How was the shop — the listing, the packaging, the seller?"
            />
          </label>
          <button className="primary" disabled={task.busy}>
            {mine ? "Save review" : "Post review"}
          </button>{" "}
          {mine && (
            <button type="button" disabled={task.busy} onClick={remove}>
              Delete review
            </button>
          )}
        </form>
      )}

      {eligibility.data && !eligibility.data.eligible && (
        <p className="muted">
          You can review this shop once an order from it has been delivered.
        </p>
      )}
    </section>
  );
}

// Returning something from this order.
//
// Only a delivered order can be returned, and the server says so too, so the
// form is offered only then. What the customer chooses here is the listing and
// how many units; the amount they are owed is not a field, because it is the
// order line's own price and the server computes it. A form that let them name
// their own refund would be asking them to price their own compensation.
//
// The list below the form is the whole history for this order, including
// refusals — a declined request that vanished would leave the customer with no
// record that they had asked and no way to see why.
function OrderReturns({ order }) {
  const all = useResource("/returns");
  const task = useTask();
  const [open, setOpen] = useState(false);

  const mine = (all.data ?? []).filter(
    (item) => item.order_id === Number(order.order_id),
  );
  const withOpenReturn = new Set(
    mine
      .filter((item) => item.status !== "rejected")
      .map((item) => item.prod_id),
  );

  async function send(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const ok = await task.run(() =>
      api("/returns", {
        method: "POST",
        body: JSON.stringify({ ...body, order_id: order.order_id }),
      }),
    );
    if (ok) {
      setOpen(false);
      all.reload();
    }
  }

  const canAsk =
    order.order_status === "delivered" &&
    order.items.some((item) => !withOpenReturn.has(item.prod_id));

  return (
    <section className="panel">
      <h2>Returns</h2>
      <Feedback error={task.error || all.error} message={task.message} />

      {order.order_status !== "delivered" && mine.length === 0 && (
        <p className="muted">
          You can return an item once the order has been delivered.
        </p>
      )}

      {mine.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Listing</th>
                <th scope="col">Units</th>
                <th scope="col">Refund</th>
                <th scope="col">Status</th>
                <th scope="col">Shop's answer</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((item) => (
                <tr key={item.return_id}>
                  <td>{item.listing_name}</td>
                  <td>{item.quantity}</td>
                  <td>${item.refund_amount}</td>
                  <td>
                    <span className={`status-pill status-${item.status}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="muted">{item.decision_note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canAsk &&
        (open ? (
          <form className="form" onSubmit={send}>
            <label>
              <span>Item <span className="required-tag" aria-hidden="true">*</span></span>
              <select name="prod_id" required>
                {order.items
                  .filter((item) => !withOpenReturn.has(item.prod_id))
                  .map((item) => (
                    <option key={item.prod_id} value={item.prod_id}>
                      {item.name} (up to {item.quantity})
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>How many units <span className="required-tag" aria-hidden="true">*</span></span>
              <input
                name="quantity"
                type="number"
                min="1"
                max="2147483647"
                required
              />
            </label>
            <label>
              <span>Why <span className="required-tag" aria-hidden="true">*</span></span>
              <textarea
                name="reason"
                rows="3"
                maxLength="2000"
                required
                placeholder="What is wrong with it?"
              />
            </label>
            <button className="primary" disabled={task.busy}>
              Ask to return it
            </button>{" "}
            <button type="button" onClick={() => setOpen(false)}>
              Never mind
            </button>
            <p className="required-note">*required</p>
          </form>
        ) : (
          <button onClick={() => setOpen(true)}>Return an item</button>
        ))}

      {mine.some((item) => item.status === "approved") && (
        <p className="muted">
          A courier will collect the parcel. Nothing needs doing until they
          arrive.
        </p>
      )}
      {mine.some((item) => item.status === "restocked") && (
        <p className="muted">
          Your refund was paid when the shop accepted the return, not when the
          parcel arrived.
        </p>
      )}
    </section>
  );
}

// One order in full: what was bought, what it cost, where it is going and how the
// payment stands. Cancelling lives here rather than on the list, because it is the
// one action on an order and it is only legal while the order is still pending.
export default function OrderDetailPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const task = useTask();
  const order = useResource(`/orders/${orderId}`);
  const [cancelled, setCancelled] = useState(false);

  const data = order.data;
  const canCancel =
    data?.order_status === "pending" && !cancelled && !task.busy;

  async function cancel() {
    const ok = await task.run(() => api(`/orders/${orderId}/cancel`, { method: "PUT" }));
    if (ok) {
      setCancelled(true);
      order.reload();
    }
  }

  return (
    <main className="content narrow" aria-busy={order.isLoading}>
      <div className="page-heading">
        <h1>Order #{orderId}</h1>
        <Link to="/orders">All my orders</Link>
      </div>

      {/* Held back until the order has loaded: the amount is part of the
          sentence, and "$ ready in cash" is worse than saying nothing. */}
      {location.state?.justPlaced && data && (
        <p className="notice" role="status">
          Order placed. Keep ${data.total_amount} ready in cash for the courier.
        </p>
      )}

      <Feedback error={task.error || order.error} message={task.message} />

      {order.isLoading && <p role="status">Loading the order...</p>}

      {data && (
        <>
          <section className="panel">
            <OrderStatus order={data} />
            <dl className="order-facts">
              <div>
                <dt>Placed</dt>
                <dd>{new Date(data.created_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Delivered</dt>
                <dd>
                  {data.delivered_at
                    ? new Date(data.delivered_at).toLocaleString()
                    : "Not yet"}
                </dd>
              </div>
              <div>
                <dt>Courier</dt>
                <dd>{data.delivery_person_name || "Waiting for one"}</dd>
              </div>
              <div>
                <dt>Delivery address</dt>
                <dd>
                  {[
                    data.street_address,
                    data.city,
                    data.state_province,
                    data.postal_code,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <h2>Items</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Shop</th>
                    <th scope="col">Quantity</th>
                    <th scope="col">Unit price</th>
                    <th scope="col">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.prod_id}>
                      <td>
                        <Link to={`/products/${item.prod_id}`}>{item.name}</Link>
                      </td>
                      <td>{item.shop_name}</td>
                      <td>{item.quantity}</td>
                      <td>${item.unit_price}</td>
                      <td>${item.subtotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cart-total">
              Total: <strong>${data.total_amount}</strong>
            </p>
            <p className="muted">
              {data.payment_status === "completed"
                ? `Paid in cash${data.paid_at ? ` on ${new Date(data.paid_at).toLocaleString()}` : ""}.`
                : data.payment_status === "failed"
                  ? "This payment is no longer expected: the order was cancelled."
                  : `Pay $${data.payment_amount} in cash when the order arrives.`}
            </p>
          </section>

          {data.order_status === "pending" && (
            <section className="panel">
              <h2>Cancel this order</h2>
              <p className="muted">
                Cancelling returns the items to the shops. An order that has
                already been collected cannot be cancelled.
              </p>
              <button disabled={!canCancel} onClick={cancel}>
                {cancelled ? "Order cancelled" : "Cancel order"}
              </button>
            </section>
          )}

          {/* Always shown, even before there is anything to return: the panel is
              where a customer finds out that returns exist, and a missing panel
              answers none of the questions a missing form raises. */}
          <OrderReturns order={data} />

          {/* One panel per shop rather than per listing: a review is about the
              seller, and two items from the same shop are one seller. */}
          {Array.from(
            new Map(data.items.map((item) => [item.shop_id, item.shop_name])),
            ([shopId, shopName]) => (
              <ShopReviews key={shopId} shopId={shopId} shopName={shopName} />
            ),
          )}
        </>
      )}
    </main>
  );
}
