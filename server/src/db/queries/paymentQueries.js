// The money surfaces. Every read here answers some version of "where did the
// money go", and each one is scoped to exactly one role's right to ask:
//
//   admin    — every payment, every vendor refund, and the commission on each order
//   vendor   — what they paid out, what they took in, and what they were refunded
//   customer — their own payments, and nothing else
//
// Scope is never a parameter. The caller's own id arrives from the session cookie
// and is the only thing that decides which rows come back, so no amount of
// query-string guessing widens a vendor's view to another shop's takings.
//
// Money is cast to numeric(12,2) on the way out. node-pg hands numeric columns
// back as strings; the cast is what keeps that string at two decimal places
// rather than at whatever scale the arithmetic happened to produce.

const { escapeLikePattern } = require("../sql");

// Mirrors the CHECK constraints on payments and vendor_refunds. The lists live
// here rather than in a controller so the query builder and the validator cannot
// disagree about what a filter is allowed to say.
const PAYMENT_STATUSES = ["pending", "completed", "failed"];
const PAYMENT_METHODS = ["prepaid", "cash_on_delivery"];
const REFUND_REASONS = ["admin_removal", "shop_closed"];

// Free text on a money list means a name, an email, or an order number. The
// columns vary per list, so they are passed in. `orderRef` is the qualified order
// id column to also match, or null for a list that has no order to point at —
// the refunds list, where a vendor refund compensates a shop for unsold stock
// and is attached to no customer order at all.
//
// The order number is always compared as text, so typing a name is simply false
// there rather than raising 22P02 on a failed integer cast.
function searchCondition(values, term, columns, orderRef) {
  values.push(`%${escapeLikePattern(term)}%`);
  const like = `$${values.length}`;
  const matches = columns.map((column) => `${column} ILIKE ${like} ESCAPE '\\'`);
  if (orderRef) {
    values.push(term);
    matches.push(`${orderRef}::text = $${values.length}`);
  }
  return `(${matches.join(" OR ")})`;
}

// =========================================================
// Admin
// =========================================================

// One row per payment, with the order it settles and the customer who placed it.
// total_amount is the goods alone and delivery_cost is separate — they are the
// two halves fn_recalc_order_total keeps apart, and pay.amount is their sum, so
// showing all three is what lets an admin see that the arithmetic holds.
//
// platform_commission is read here rather than from order_items: the order-level
// column is the sum of the lines, and it is zeroed when an order is cancelled
// (migrations/008), so a failed payment never shows platform revenue beside it.
function buildPaymentListQuery({ q: term, status, method, page, limit }) {
  const values = [];
  const conditions = [];

  if (term)
    conditions.push(
      searchCondition(values, term, ["u.name", "u.email"], "o.order_id"),
    );
  if (status) {
    values.push(status);
    conditions.push(`pay.payment_status = $${values.length}`);
  }
  if (method) {
    values.push(method);
    conditions.push(`pay.payment_method = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  values.push(limit, (page - 1) * limit);

  return {
    text: `
      SELECT pay.transaction_id, pay.payment_method, pay.payment_status, pay.paid_at,
             pay.amount::numeric(12,2) AS amount,
             o.order_id, o.order_status, o.created_at AS order_created_at,
             o.total_amount::numeric(12,2) AS total_amount,
             o.delivery_cost::numeric(12,2) AS delivery_cost,
             o.platform_commission::numeric(12,2) AS platform_commission,
             u.user_id AS customer_id, u.name AS customer_name,
             u.email AS customer_email,
             COUNT(*) OVER() AS total_count
      FROM payments pay
      JOIN orders o ON o.order_id = pay.order_id
      JOIN users u ON u.user_id = o.user_id
      ${where}
      ORDER BY pay.transaction_id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
    values,
  };
}

// What the platform has paid vendors back. The acting administrator is joined in
// because "who removed this" is the first question anyone asks of a refund row,
// and a name on the screen is worth more than an id in an audit query.
function buildRefundListQuery({ q: term, reason, page, limit }) {
  const values = [];
  const conditions = [];

  if (term)
    conditions.push(searchCondition(values, term, ["s.name", "p.name"], null));
  if (reason) {
    values.push(reason);
    conditions.push(`vr.reason = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  values.push(limit, (page - 1) * limit);

  return {
    text: `
      SELECT vr.refund_id, vr.reason, vr.created_at,
             vr.units, vr.amount::numeric(12,2) AS amount,
             vr.unit_amount::numeric(12,2) AS unit_amount,
             s.shop_id, s.name AS shop_name,
             p.prod_id, p.name AS listing_name,
             mp.master_prod_id, mp.name AS master_name,
             a.user_id AS admin_id, a.name AS admin_name, a.email AS admin_email,
             COUNT(*) OVER() AS total_count
      FROM vendor_refunds vr
      JOIN shops s ON s.shop_id = vr.shop_id
      JOIN products p ON p.prod_id = vr.prod_id
      JOIN master_products mp ON mp.master_prod_id = vr.master_prod_id
      JOIN users a ON a.user_id = vr.removed_by
      ${where}
      ORDER BY vr.refund_id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
    values,
  };
}

// =========================================================
// Vendor
// =========================================================

// One row per sale of one of this vendor's listings.
//
// The customer's name is deliberately absent. A vendor does not deliver — the
// courier does, and the courier already has the name — so a vendor has no use
// for it, and a marketplace that hands every seller their buyers' identities is
// a marketplace that leaks them. The order id is enough to reconcile against.
//
// A cancelled order's lines survive (fn_cleanup_cancelled_order returns the stock
// rather than deleting history), so order_status comes back with each row and the
// totals below leave cancelled orders out.
const LIST_OWNED_SALES = `
    SELECT oi.order_id, oi.prod_id, oi.quantity,
           oi.unit_price::numeric(12,2) AS unit_price,
           (oi.quantity * oi.unit_price)::numeric(12,2) AS subtotal,
           oi.platform_commission::numeric(12,2) AS platform_commission,
           (oi.quantity * oi.unit_price - oi.platform_commission)::numeric(12,2) AS net_to_shop,
           o.order_status, o.created_at,
           p.name AS listing_name,
           s.shop_id, s.name AS shop_name
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    JOIN products p ON p.prod_id = oi.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    WHERE s.owner = $1
    ORDER BY o.created_at DESC, oi.order_id DESC, oi.prod_id
`;

// What a vendor has been refunded for stock the platform removed. Same shape as
// the admin list minus the acting administrator, who is not the vendor's
// business — the reason and the amount are.
const LIST_OWNED_REFUNDS = `
    SELECT vr.refund_id, vr.reason, vr.created_at,
           vr.units, vr.amount::numeric(12,2) AS amount,
           vr.unit_amount::numeric(12,2) AS unit_amount,
           s.shop_id, s.name AS shop_name,
           p.prod_id, p.name AS listing_name,
           mp.master_prod_id, mp.name AS master_name
    FROM vendor_refunds vr
    JOIN shops s ON s.shop_id = vr.shop_id
    JOIN products p ON p.prod_id = vr.prod_id
    JOIN master_products mp ON mp.master_prod_id = vr.master_prod_id
    WHERE s.owner = $1
    ORDER BY vr.refund_id DESC
`;

// The running balance the admin path writes into. Separate from LIST_OWNED_SHOPS
// because the payments page wants three numbers per shop, not a shop record.
const LIST_OWNED_EARNINGS = `
    SELECT shop_id, name, earnings::numeric(12,2) AS earnings, active_status
    FROM shops
    WHERE owner = $1
    ORDER BY shop_id
`;

// The vendor's totals, computed in the database rather than by adding up the
// three lists above: those lists are unbounded, and a page that sums whatever it
// happened to load would quietly disagree with itself as the window moved.
//
// Cancelled orders are excluded from every figure. A cancelled order returned its
// stock, failed its payment and voided its commission, so counting it as a sale
// would have a vendor's revenue include money nobody ever paid.
const OWNED_TOTALS = `
    SELECT
      (SELECT COALESCE(SUM(sp.quantity * sp.wholesale_unit_price), 0)::numeric(12,2)
       FROM shop_purchases sp JOIN shops s ON s.shop_id = sp.shop_id
       WHERE s.owner = $1) AS wholesale_spend,
      (SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric(12,2)
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       JOIN products p ON p.prod_id = oi.prod_id
       JOIN shops s ON s.shop_id = p.shop_id
       WHERE s.owner = $1 AND o.order_status <> 'cancelled') AS gross_sales,
      (SELECT COALESCE(SUM(oi.platform_commission), 0)::numeric(12,2)
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       JOIN products p ON p.prod_id = oi.prod_id
       JOIN shops s ON s.shop_id = p.shop_id
       WHERE s.owner = $1 AND o.order_status <> 'cancelled') AS commission_paid,
      (SELECT COALESCE(SUM(vr.amount), 0)::numeric(12,2)
       FROM vendor_refunds vr JOIN shops s ON s.shop_id = vr.shop_id
       WHERE s.owner = $1) AS refunds_received,
      (SELECT COALESCE(SUM(s.earnings), 0)::numeric(12,2)
       FROM shops s WHERE s.owner = $1) AS earnings_balance
`;

// =========================================================
// Customer
// =========================================================

// A customer's own payments. No platform_commission and no vendor's share: what
// they paid, how, and whether it has settled.
const LIST_OWNED_PAYMENTS = `
    SELECT pay.transaction_id, pay.payment_method, pay.payment_status, pay.paid_at,
           pay.amount::numeric(12,2) AS amount,
           o.order_id, o.order_status, o.created_at,
           o.total_amount::numeric(12,2) AS total_amount,
           o.delivery_cost::numeric(12,2) AS delivery_cost
    FROM payments pay
    JOIN orders o ON o.order_id = pay.order_id
    WHERE o.user_id = $1
    ORDER BY pay.transaction_id DESC
`;

module.exports = {
  LIST_OWNED_EARNINGS,
  LIST_OWNED_PAYMENTS,
  LIST_OWNED_REFUNDS,
  LIST_OWNED_SALES,
  OWNED_TOTALS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  REFUND_REASONS,
  buildPaymentListQuery,
  buildRefundListQuery,
};
