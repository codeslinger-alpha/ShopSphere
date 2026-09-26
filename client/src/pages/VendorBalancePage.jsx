import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/http";
import { useResource, useTask } from "../hooks/useResource";
import { Feedback } from "../components/FormFields";

// The shop's balance, the movements behind it, and the form that adds to it.
//
// The balance is a running total kept by the server, so the list below it is not
// decoration: it is the arithmetic, and a vendor who doubts the headline can add
// the column up. Both come from one request, so they cannot disagree.
//
// There is no payment gateway and the page does not pretend otherwise. The button
// records a recharge; no card is charged, and the server's own response says so.
const money = (value) => `$${value}`;

const MOVEMENT_LABELS = {
  sale: "Sale delivered",
  purchase: "Wholesale purchase",
  topup: "Recharge",
  admin_refund: "Refund for removed stock",
  customer_return: "Customer return approved",
};

function MovementList({ movements }) {
  if (movements.length === 0)
    return (
      <p className="empty-state">
        Nothing has moved yet. Sales, purchases and recharges all appear here.
      </p>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>What</th>
            <th>Reference</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => {
            const amount = Number(movement.amount);
            return (
              <tr
                key={`${movement.kind}:${movement.reference ?? movement.created_at}`}
              >
                <td>{new Date(movement.created_at).toLocaleDateString()}</td>
                <td>
                  {MOVEMENT_LABELS[movement.kind] ?? movement.kind}
                  {movement.quantity ? (
                    <span className="muted"> · {movement.quantity} units</span>
                  ) : null}
                </td>
                <td className="muted">#{movement.reference}</td>
                {/* Signed and coloured by direction, so the column can be added
                    up by eye without reading every label. */}
                <td className={amount < 0 ? "error" : ""}>
                  {amount < 0 ? "−" : "+"}
                  {money(Math.abs(amount).toFixed(2))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function VendorBalancePage() {
  const shops = useResource("/vendor/shops");
  const task = useTask();
  const [chosen, setChosen] = useState("");
  const shopId = chosen || String(shops.data?.[0]?.shop_id ?? "");
  const book = useResource(shopId ? `/vendor/balance?shop_id=${shopId}` : "");
  const [form, setForm] = useState({ amount: "", method: "card" });

  async function recharge(event) {
    event.preventDefault();
    const done = await task.run(() =>
      api("/vendor/topups", {
        method: "POST",
        body: JSON.stringify({
          shop_id: shopId,
          amount: form.amount,
          method: form.method,
        }),
      }),
    );
    if (done) {
      setForm({ ...form, amount: "" });
      book.reload();
      shops.reload();
    }
  }

  if (shops.isLoading) return <p role="status">Loading your shops…</p>;

  return (
    <main className="content">
      <h1>Shop balance</h1>
      <nav className="tabs">
        <Link to="/vendor/shops">My shops</Link>
        <Link to="/vendor/inventory">Inventory and purchases</Link>
        <Link to="/vendor/balance">Balance</Link>
        <Link to="/vendor/statistics">Income</Link>
        <Link to="/vendor/payments">Payments</Link>
      </nav>
      <Feedback
        error={task.error || shops.error || book.error}
        message={task.message}
      />

      {shops.data?.length === 0 ? (
        <p className="empty-state">
          You have no shops yet. <Link to="/vendor/shops">Create one</Link> and an
          administrator will review it.
        </p>
      ) : (
        <>
          <section className="panel">
            {shops.data?.length > 1 && (
              <label>
                Shop
                <select
                  value={shopId}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  {shops.data.map((shop) => (
                    <option key={shop.shop_id} value={shop.shop_id}>
                      {shop.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <h2>{book.data?.name ?? "Balance"}</h2>
            <dl className="order-facts">
              <div>
                <dt>Balance</dt>
                <dd>
                  {money(book.data?.balance ?? "0.00")}
                  <br />
                  <span className="muted">
                    Sales and recharges in, wholesale buying and approved returns
                    out. Buying stock is refused when this cannot cover it.
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="panel form">
            <h2>Recharge</h2>
            <form onSubmit={recharge}>
              <label>
                Amount
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) =>
                    setForm({ ...form, amount: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                Method
                <select
                  value={form.method}
                  onChange={(event) =>
                    setForm({ ...form, method: event.target.value })
                  }
                >
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                </select>
              </label>
              <button className="primary" disabled={task.busy}>
                Recharge balance
              </button>
            </form>
            <p className="muted">
              There is no payment gateway here. This records the recharge against
              your shop; no card is charged.
            </p>
          </section>

          <h2>What moved it</h2>
          {book.isLoading ? (
            <p role="status">Loading movements…</p>
          ) : (
            <MovementList movements={book.data?.movements ?? []} />
          )}
        </>
      )}
    </main>
  );
}
