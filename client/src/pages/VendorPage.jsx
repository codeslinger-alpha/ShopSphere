import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/http";
import { useResource, useTask } from "../hooks/useResource";
import {
  AddressFields,
  Feedback,
  MarkdownField,
  MasterFacts,
} from "../components/FormFields";
function VendorProductReviews({ productId }) {
  const [open, setOpen] = useState(false);
  const reviews = useResource(
    open ? `/products/${productId}/reviews` : "",
  );

  return (
    <>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        {open ? "Hide reviews" : "View reviews"}
      </button>
      {open && (
        <div>
          {reviews.isLoading ? (
            <p role="status">Loading reviews…</p>
          ) : reviews.error ? (
            <p role="alert">{reviews.error}</p>
          ) : reviews.data?.length ? (
            <ul className="stack-list">
              {reviews.data.map((review) => (
                <li key={review.user_id}>
                  <strong>{review.name}</strong> · {review.rating}/5
                  <p className="muted">{review.review || "No review text."}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No reviews yet.</p>
          )}
        </div>
      )}
    </>
  );
}

function ShopEditor({ shop, onSave, busy }) {
  return (
    <form
      className="panel form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      <h2>{shop.shop_id ? "Edit shop" : "Create shop"}</h2>
      <fieldset disabled={busy}>
        <label>
          Shop name
          <input
            name="name"
            defaultValue={shop.name || ""}
            maxLength="120"
            required
          />
        </label>
        <label>
          Shop phone
          <input
            name="phone_numbers"
            type="tel"
            defaultValue={shop.phone_numbers || ""}
            maxLength="20"
            required
          />
        </label>
        <label>
          Logo URL
          <input name="logo" type="url" defaultValue={shop.logo || ""} />
        </label>
        <label>
          Cover photo URL
          <input
            name="cover_photo"
            type="url"
            defaultValue={shop.cover_photo || ""}
          />
        </label>
        <MarkdownField value={shop.description} />
        <AddressFields value={shop} />
        {/* Shop status belongs to the administrator. The server ignores it from
            this form, so it is reported here rather than offered as a choice. */}
        <p className="shop-status">
          {shop.shop_id ? (
            <>
              Status:{" "}
              <span className={`status-pill status-${shop.active_status}`}>
                {shop.active_status}
              </span>
              {shop.active_status === "pending" &&
                " — waiting for an administrator to approve this shop before shoppers can see it."}
              {shop.active_status === "disabled" &&
                " — an administrator has disabled this shop, so its listings are not on sale. They have to restore it."}
            </>
          ) : (
            "A new shop goes to an administrator for approval and stays hidden from shoppers until it is approved."
          )}
        </p>
        <button className="primary">Save shop</button>
      </fieldset>
    </form>
  );
}
function ListingEditor({ listing, onSave, busy }) {
  return (
    <form
      className="panel form"
      onSubmit={(e) => {
        e.preventDefault();
        const b = Object.fromEntries(new FormData(e.currentTarget));
        onSave({ ...b, discontinued: b.discontinued === "true" });
      }}
    >
      <h2>Edit {listing.name}</h2>
      <p>Stock: {listing.in_stock}. Buy more units to restock.</p>
      <fieldset disabled={busy}>
        <label>
          Retail price
          <input
            name="unit_price"
            type="number"
            min="0"
            max="9999999999.99"
            step="0.01"
            defaultValue={listing.unit_price}
            required
          />
        </label>
        <MarkdownField label="Your description" value={listing.description} />
        <label>
          Listing status
          <select
            name="discontinued"
            defaultValue={String(listing.discontinued)}
          >
            <option value="false">Listed</option>
            <option value="true">Discontinued</option>
          </select>
        </label>
        <button className="primary">Save listing</button>
      </fieldset>
    </form>
  );
}
// The vendor's books: what came in, what went out, what was refunded, and what
// the platform is holding for them.
//
// The headline figures come from the server's own totals rather than from adding
// up the tables below. Those tables are not paginated, but they are the whole
// history, and a screen that sums whatever it happens to be showing would start
// disagreeing with itself the moment either changed.
//
// The resource is loaded by the page rather than here so the returns panel below
// can reload it: accepting a return moves the balance, and a headline figure that
// kept showing the old number on the same screen would be worse than no figure.
function VendorPayments({ books }) {
  if (books.isLoading) return <p role="status">Loading your books…</p>;
  if (books.error)
    return (
      <p className="error" role="alert">
        {books.error}
      </p>
    );
  if (!books.data) return null;

  const { sales, purchases, refunds, shops, totals } = books.data;
  const money = (value) => `$${value}`;

  return (
    <>
      <section className="panel">
        <h2>The balance</h2>
        <dl className="order-facts">
          <div>
            <dt>Balance</dt>
            <dd>
              {money(totals.balance_total)}
              <br />
              <span className="muted">
                Sales and recharges in, wholesale buying and approved returns out.
                This is what you spend on stock.{" "}
                <Link to="/vendor/balance">Recharge it</Link>.
              </span>
            </dd>
          </div>
          <div>
            <dt>Sales</dt>
            <dd>
              {money(totals.gross_sales)}
              <br />
              <span className="muted">
                The whole of what you sold — nothing is withheld. Cancelled orders
                are excluded.
              </span>
            </dd>
          </div>
          <div>
            <dt>Wholesale spend</dt>
            <dd>
              {money(totals.wholesale_spend)}
              <br />
              <span className="muted">What you paid for the stock you bought.</span>
            </dd>
          </div>
          <div>
            <dt>Refunded to you</dt>
            <dd>
              {money(totals.refunds_received)}
              <br />
              <span className="muted">
                For stock the platform removed from sale.
              </span>
            </dd>
          </div>
        </dl>
        {shops.map((shop) => (
          <p key={shop.shop_id} className="muted">
            {shop.name}: {money(shop.balance)} ·{" "}
            <span className={`status-pill status-${shop.active_status}`}>
              {shop.active_status}
            </span>
          </p>
        ))}
      </section>

      <h2>Sales</h2>
      {sales.length === 0 ? (
        <p className="empty-state">
          Nothing has sold yet. Sales of your listings appear here as customers
          order them.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order / date</th>
                <th>Shop / listing</th>
                <th>Quantity</th>
                <th>Unit price</th>
                <th>Subtotal</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={`${sale.order_id}:${sale.prod_id}`}>
                  <td>
                    #{sale.order_id}
                    <br />
                    <span className="muted">
                      {new Date(sale.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td>
                    {sale.listing_name}
                    <br />
                    <span className="muted">{sale.shop_name}</span>
                  </td>
                  <td>{sale.quantity}</td>
                  <td>{money(sale.unit_price)}</td>
                  <td>{money(sale.subtotal)}</td>
                  <td>
                    <span className={`status-pill status-${sale.order_status}`}>
                      {sale.order_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Wholesale purchases</h2>
      {purchases.length === 0 ? (
        <p className="empty-state">You have not bought any stock yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID / date</th>
                <th>Shop / product</th>
                <th>Quantity</th>
                <th>Unit cost</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr key={purchase.purchase_id}>
                  <td>
                    {purchase.purchase_id} /{" "}
                    {new Date(purchase.purchased_at).toLocaleDateString()}
                  </td>
                  <td>
                    {purchase.shop_name} / {purchase.name}
                  </td>
                  <td>{purchase.quantity}</td>
                  <td>{money(purchase.wholesale_unit_price)}</td>
                  <td>{money(purchase.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Refunds</h2>
      {refunds.length === 0 ? (
        <p className="empty-state">
          No stock of yours has been removed by an administrator, so there is
          nothing to refund.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Refund / date</th>
                <th>Shop / listing</th>
                <th>Units</th>
                <th>Unit amount</th>
                <th>Amount</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((refund) => (
                <tr key={refund.refund_id}>
                  <td>
                    #{refund.refund_id}
                    <br />
                    <span className="muted">
                      {new Date(refund.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td>
                    {refund.listing_name}
                    <br />
                    <span className="muted">{refund.shop_name}</span>
                  </td>
                  <td>{refund.units}</td>
                  <td>{refund.unit_amount ? money(refund.unit_amount) : "—"}</td>
                  <td>{money(refund.amount)}</td>
                  <td>
                    {refund.reason === "admin_removal"
                      ? "Removed by an administrator"
                      : "Shop closed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// The returns a vendor has to deal with, and the three things they can do about
// one. They are grouped by what the return is waiting for rather than by date,
// because this is a work queue: an approved return the customer is waiting to
// hand over and a parcel sitting in the shop are different jobs, and a single
// dated list would leave the vendor working out which is which.
//
// The two decisions are separate buttons rather than one form with a status
// field, because they are not variations of a setting — one refunds the customer
// and one does not, and a mis-click between them costs money the wrong way.
function VendorReturns({ onBalanceChanged }) {
  const returns = useResource("/vendor/returns");
  const task = useTask();
  const [notes, setNotes] = useState({});

  const list = returns.data ?? [];
  const waiting = list.filter((item) => item.status === "requested");
  const inTransit = list.filter(
    (item) => item.status === "approved" || item.status === "collected",
  );
  const settled = list.filter((item) =>
    ["rejected", "restocked"].includes(item.status),
  );

  async function decide(item, action) {
    const ok = await task.run(() =>
      api(`/vendor/returns/${item.return_id}/${action}`, {
        method: "PUT",
        body: JSON.stringify({ decision_note: notes[item.return_id] || "" }),
      }),
    );
    if (ok) {
      returns.reload();
      onBalanceChanged();
    }
  }

  async function restock(item) {
    const ok = await task.run(() =>
      api(`/vendor/returns/${item.return_id}/restock`, { method: "PUT" }),
    );
    if (ok) returns.reload();
  }

  return (
    <>
      <h2>Returns from customers</h2>
      <Feedback error={task.error || returns.error} message={task.message} />

      {waiting.length === 0 ? (
        <p className="empty-state">
          Nothing is waiting for a decision. A customer can ask to return
          something once their order has been delivered.
        </p>
      ) : (
        waiting.map((item) => (
          <article className="panel" key={item.return_id}>
            <h3>
              {item.listing_name}{" "}
              <span className="muted">× {item.quantity}</span>
            </h3>
            <dl className="order-facts">
              <div>
                <dt>Order</dt>
                <dd>#{item.order_id}</dd>
              </div>
              <div>
                <dt>Customer</dt>
                <dd>{item.customer_name}</dd>
              </div>
              <div>
                <dt>Shop</dt>
                <dd>{item.shop_name}</dd>
              </div>
              <div>
                <dt>Refund if you accept</dt>
                <dd>${item.refund_amount}</dd>
              </div>
            </dl>
            <p className="muted">
              They said: {item.reason}. Accepting refunds them from your balance
              straight away and sends a courier for the parcel; the units go back
              on sale when you mark it restocked.
            </p>
            <label>
              Note to the customer
              <input
                value={notes[item.return_id] || ""}
                maxLength="2000"
                onChange={(event) =>
                  setNotes({ ...notes, [item.return_id]: event.target.value })
                }
                placeholder="Optional when you accept; required if you decline"
              />
            </label>
            <p>
              <button
                className="primary"
                disabled={task.busy}
                onClick={() => decide(item, "approve")}
              >
                Accept and refund ${item.refund_amount}
              </button>{" "}
              <button
                disabled={task.busy || !notes[item.return_id]?.trim()}
                onClick={() => decide(item, "reject")}
              >
                Decline
              </button>
            </p>
          </article>
        ))
      )}

      {inTransit.length > 0 && (
        <>
          <h2>On their way back</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Listing</th>
                  <th scope="col">Units</th>
                  <th scope="col">Refunded</th>
                  <th scope="col">Courier</th>
                  <th scope="col">Waiting for</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {inTransit.map((item) => (
                  <tr key={item.return_id}>
                    <td>{item.listing_name}</td>
                    <td>{item.quantity}</td>
                    <td>${item.refund_amount}</td>
                    <td>{item.collected_by_name || "A courier"}</td>
                    <td>
                      <span className={`status-pill status-${item.status}`}>
                        {item.status}
                      </span>
                    </td>
                    <td>
                      {/* The refund was paid on approval, so restocking moves
                          stock and no money — and only after the courier has
                          actually handed the parcel over. */}
                      <button
                        disabled={task.busy || item.status !== "collected"}
                        onClick={() => restock(item)}
                      >
                        {item.status === "collected"
                          ? "Mark back in stock"
                          : "Not collected yet"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {settled.length > 0 && (
        <>
          <h2>Return history</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Return / date</th>
                  <th scope="col">Listing</th>
                  <th scope="col">Units</th>
                  <th scope="col">Refund</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Your note</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((item) => (
                  <tr key={item.return_id}>
                    <td>
                      #{item.return_id}
                      <br />
                      <span className="muted">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </td>
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
        </>
      )}
    </>
  );
}

export default function VendorPage({ page }) {
  const shops = useResource("/vendor/shops");
  const masters = useResource("/vendor/master-products");
  const [shop, setShop] = useState({});
  const [selected, setSelected] = useState("");
  const [shopFilter, setShopFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [revision, setRevision] = useState(0);

  const selectedShop =
    shops.data?.find((entry) => String(entry.shop_id) === String(shopFilter)) ||
    null;
  const listings = useResource(
    `/vendor/listings${shopFilter !== "all" ? `?shop_id=${shopFilter}` : ""}`,
  );
  const purchases = useResource(
    `/vendor/purchases${shopFilter !== "all" ? `?shop_id=${shopFilter}` : ""}`,
  );
  const books = useResource(
    page === "payments"
      ? `/vendor/payments${shopFilter !== "all" ? `?shop_id=${shopFilter}` : ""}`
      : "",
  );
  const reviews = useResource(
    selectedShop ? `/vendor/shops/${selectedShop.shop_id}/reviews` : "",
  );

  const product =
    masters.data?.find((p) => String(p.master_prod_id) === selected) ||
    masters.data?.[0];
  const activeShops =
    shops.data?.filter((s) => s.active_status === "active") || [];
  const filteredListings = listings.data || [];
  const filteredPurchases = purchases.data || [];

  async function write(path, method, body) {
    return task.run(() => api(path, { method, body: JSON.stringify(body) }));
  }

  const task = useTask();

  return (
    <main className="content">
      <h1>
        {page === "shops"
          ? "My shops"
          : page === "payments"
            ? "Payments"
            : "Buy and list products"}
      </h1>
      <nav className="tabs">
        <Link to="/vendor/shops">My shops</Link>
        <Link to="/vendor/inventory">Inventory and purchases</Link>
        <Link to="/vendor/balance">Balance</Link>
        <Link to="/vendor/statistics">Income</Link>
        <Link to="/vendor/payments">Payments</Link>
      </nav>
      <div className="panel">
        <label>
          Shop view
          <select
            value={shopFilter}
            onChange={(event) => setShopFilter(event.target.value)}
          >
            <option value="all">All my shops</option>
            {shops.data?.map((shopEntry) => (
              <option key={shopEntry.shop_id} value={shopEntry.shop_id}>
                {shopEntry.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Feedback
        error={
          task.error ||
          shops.error ||
          masters.error ||
          listings.error ||
          purchases.error
        }
        message={task.message}
      />
      {page === "payments" ? (
        <>
          <VendorPayments books={books} />
          <VendorReturns onBalanceChanged={books.reload} />
        </>
      ) : page === "shops" ? (
        <div className="workspace-grid">
          <section>
            <button onClick={() => setShop({})}>New shop</button>
            {shops.data?.map((s) => (
              <article className="collection-row" key={s.shop_id}>
                <div>
                  <h2>{s.name}</h2>
                  <p>
                    <span className={`status-pill status-${s.active_status}`}>
                      {s.active_status}
                    </span>{" "}
                    · {s.city} · Balance {s.balance}
                  </p>
                  <p>
                    ID {s.shop_id} · Owner {s.owner} · Created{" "}
                    {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={() => setShop(s)}>Edit shop</button>
              </article>
            ))}
          </section>
          <div>
            <ShopEditor
              key={`${shop.shop_id || "new"}:${revision}`}
              shop={shop}
              busy={task.busy}
              onSave={async (body) => {
                if (
                  await write(
                    shop.shop_id
                      ? `/vendor/shops/${shop.shop_id}`
                      : "/vendor/shops",
                    shop.shop_id ? "PUT" : "POST",
                    body,
                  )
                ) {
                  shops.reload();
                  setShop({});
                  setRevision((n) => n + 1);
                }
              }}
            />
            {selectedShop && (
              <section className="panel">
                <h2>{selectedShop.name} reviews</h2>
                {reviews.isLoading ? (
                  <p role="status">Loading reviews…</p>
                ) : (reviews.data?.length ?? 0) > 0 ? (
                  <ul className="stack-list">
                    {reviews.data.map((review) => (
                      <li key={`${review.user_id}:${review.last_modified}`}>
                        <strong>{review.name}</strong> · {review.rating}/5
                        <p className="muted">
                          {review.review || "No review text."}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state">
                    No customer reviews yet for this shop.
                  </p>
                )}
              </section>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="workspace-grid">
            <form
              className="panel form"
              key={revision}
              onSubmit={async (e) => {
                e.preventDefault();
                const body = Object.fromEntries(new FormData(e.currentTarget));
                if (await write("/vendor/listings", "POST", body)) {
                  listings.reload();
                  purchases.reload();
                  setRevision((n) => n + 1);
                }
              }}
            >
              <h2>Wholesale purchase</h2>
              <p>
                Buying an existing shop/product pair adds stock to its listing.
                Prices are recorded at purchase time. This demo records
                purchases without charging a payment account.
              </p>
              <fieldset disabled={task.busy || !product || !activeShops.length}>
                <label>
                  Shop
                  <select name="shop_id" required>
                    <option value="">Choose your shop</option>
                    {activeShops.map((s) => (
                      <option key={s.shop_id} value={s.shop_id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Master product
                  <select
                    name="master_prod_id"
                    value={product?.master_prod_id || ""}
                    onChange={(e) => setSelected(e.target.value)}
                    required
                  >
                    {masters.data?.map((p) => (
                      <option key={p.master_prod_id} value={p.master_prod_id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Purchase quantity
                  <input
                    name="quantity"
                    type="number"
                    min="1"
                    max="2147483647"
                    required
                  />
                </label>
                <label>
                  Your retail price
                  <input
                    name="unit_price"
                    type="number"
                    min="0"
                    max="9999999999.99"
                    step="0.01"
                    required
                  />
                </label>
                <MarkdownField label="Your description" />
                <button className="primary">Buy and list product</button>
              </fieldset>
              {!activeShops.length && <p>Create an active shop first.</p>}
              {masters.data?.length === 0 && (
                <p>No available master products.</p>
              )}
            </form>
            {product && <MasterFacts product={product} />}
          </div>
          <h2>Your listings</h2>
          {filteredListings.length === 0 ? (
            <p className="empty-state">
              {shopFilter === "all"
                ? "No listings yet for your shops."
                : "No listings for the selected shop."}
            </p>
          ) : (
            filteredListings.map((p) => (
              <article className="collection-row" key={p.prod_id}>
                <div>
                  <h3>{p.name}</h3>
                  <p>
                    {p.shop_name} · {p.category_name} · Stock {p.in_stock} · ${p.unit_price} · {p.discontinued ? "Discontinued" : "Listed"}
                  </p>
                  <p>
                    ID {p.prod_id} · Master {p.master_prod_id}
                  </p>
                </div>
                <button onClick={() => setEditing(p)}>Edit listing</button>
                <VendorProductReviews productId={p.prod_id} />
              </article>
            ))
          )}
          {editing && (
            <ListingEditor
              key={editing.prod_id}
              listing={editing}
              busy={task.busy}
              onSave={async (body) => {
                if (
                  await write(
                    `/vendor/listings/${editing.prod_id}`,
                    "PUT",
                    body,
                  )
                ) {
                  setEditing(null);
                  listings.reload();
                }
              }}
            />
          )}
          <h2>Wholesale purchase history</h2>
          {filteredPurchases.length === 0 ? (
            <p className="empty-state">
              {shopFilter === "all"
                ? "No purchases recorded yet."
                : "No purchases recorded for the selected shop."}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID / date</th>
                    <th>Shop / product</th>
                    <th>Quantity</th>
                    <th>Unit cost</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPurchases.map((p) => (
                    <tr key={p.purchase_id}>
                      <td>
                        {p.purchase_id} / {new Date(p.purchased_at).toLocaleString()}
                      </td>
                      <td>
                        {p.shop_name} / {p.name}
                      </td>
                      <td>{p.quantity}</td>
                      <td>{p.wholesale_unit_price}</td>
                      <td>{p.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
