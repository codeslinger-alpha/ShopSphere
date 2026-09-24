import { Link } from "react-router-dom";
import { useResource } from "../hooks/useResource";
import { Feedback } from "../components/FormFields";

// The customer's own payment history, in one place rather than one row at a time
// on each order.
//
// Deliberately narrow: the amount, how it was paid, whether it has settled, and a
// way back to the order it settles. The platform's commission and the vendor's
// share are not the customer's business and the server does not send them, so
// there is nothing here to leave out.
export default function AccountPaymentsPage() {
  const payments = useResource("/account/payments");
  const items = payments.data ?? [];

  const settled = items
    .filter((payment) => payment.payment_status === "completed")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);

  return (
    <main className="content" aria-busy={payments.isLoading}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Payment history</h1>
        </div>
        <Link to="/orders">My orders</Link>
      </div>

      <Feedback error={payments.error} />

      {payments.isLoading ? (
        <p role="status">Loading your payments...</p>
      ) : items.length === 0 ? (
        <div className="empty-state">
          You have no payments yet. Every order creates one, paid in cash when it
          arrives. <Link to="/products">Find something to order</Link>
        </div>
      ) : (
        <>
          <p className="muted">
            {items.length} payment{items.length === 1 ? "" : "s"} · $
            {settled.toFixed(2)} settled in cash. ShopSphere charges no card and
            holds no card details.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Placed</th>
                  <th scope="col">Goods</th>
                  <th scope="col">Delivery</th>
                  <th scope="col">Paid</th>
                  <th scope="col">Method</th>
                  <th scope="col">Status</th>
                  <th scope="col">Settled</th>
                </tr>
              </thead>
              <tbody>
                {items.map((payment) => (
                  <tr key={payment.transaction_id}>
                    <td>
                      <Link to={`/orders/${payment.order_id}`}>
                        Order #{payment.order_id}
                      </Link>
                    </td>
                    <td>{new Date(payment.created_at).toLocaleDateString()}</td>
                    <td>${payment.total_amount}</td>
                    <td>${payment.delivery_cost}</td>
                    <td>${payment.amount}</td>
                    <td>
                      {payment.payment_method === "cash_on_delivery"
                        ? "Cash on delivery"
                        : "Prepaid"}
                    </td>
                    <td>
                      <span
                        className={`status-pill status-${payment.payment_status}`}
                      >
                        {payment.payment_status}
                      </span>
                    </td>
                    <td>
                      {payment.paid_at
                        ? new Date(payment.paid_at).toLocaleString()
                        : "Not yet"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
