// Where the order is, and where its money is. The two move independently: an
// order is delivered while its payment is still pending until the courier hands
// it over, and a cancelled order leaves a failed payment behind rather than a
// pending one. Showing both is what stops "pending" on its own from being
// mistaken for "not paid yet" when it actually means "no longer expected".
const ORDER_LABELS = {
  pending: "Pending",
  shipped: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const PAYMENT_LABELS = {
  pending: "Cash due on delivery",
  completed: "Paid in cash",
  failed: "Payment cancelled",
};

export default function OrderStatus({ order, showPayment = true }) {
  return (
    <div className="status-row">
      <span className={`status-pill status-${order.order_status}`}>
        {ORDER_LABELS[order.order_status] ?? order.order_status}
      </span>
      {showPayment && order.payment_status && (
        <span className={`status-pill status-${order.payment_status}`}>
          {PAYMENT_LABELS[order.payment_status] ?? order.payment_status}
        </span>
      )}
    </div>
  );
}
