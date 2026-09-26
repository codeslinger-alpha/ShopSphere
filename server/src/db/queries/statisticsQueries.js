// The vendor's income statistics: what sold, when, and which listings did it.
//
// One scope rule runs through the file, the same as everywhere else money is
// read: the caller's own id decides which rows exist. There is no shop parameter
// to guess at, so a vendor's figures can only ever be their own shops'.
//
// The other rule is that "revenue" here means delivered revenue. A shop's balance
// is credited by settle_delivery when the courier hands the order over, and only
// then, so a statistic built on anything earlier would count money the shop has
// not been paid. An order that is still in transit is a sale in progress, and the
// payments page already shows those under a heading that says so.
//
// A return does not erase the sale that happened. The delivered revenue series
// therefore keeps the original line, and refunds are read separately from
// customer_refunds and shown beside it — so a vendor can see a good month and a
// bad one at once instead of watching history change under them.

// date_trunc takes its field as text, so the period is a bound parameter rather
// than string-stitched SQL. The controller still checks it against the closed set
// below, because the parameter is a choice the client makes and this file should
// not be the only thing standing between a query string and the database.
const PERIODS = ["day", "week", "month"];

// Revenue per period for delivered orders. The period comes back as the date the
// bucket starts — a week is labelled by its Monday — because a chart needs
// something sortable and a label like "2026-W31" is not.
const DELIVERED_REVENUE_BY_PERIOD = `
    SELECT to_char(date_trunc($2, o.delivered_at), 'YYYY-MM-DD') AS period,
           SUM(oi.quantity)::int AS units,
           SUM(oi.quantity * oi.unit_price)::numeric(12,2) AS revenue,
           COUNT(DISTINCT o.order_id)::int AS orders
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    JOIN products p ON p.prod_id = oi.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    WHERE s.owner = $1 AND o.order_status = 'delivered' AND o.delivered_at IS NOT NULL
    GROUP BY 1
    ORDER BY 1
`;

// What the shop paid back to customers, bucketed the same way. Read from
// customer_refunds rather than from the returns it came from: this table is the
// money, and a return that was requested on one day and accepted on another
// belongs in the bucket where the money actually moved.
const CUSTOMER_REFUNDS_BY_PERIOD = `
    SELECT to_char(date_trunc($2, cr.created_at), 'YYYY-MM-DD') AS period,
           SUM(cr.amount)::numeric(12,2) AS refunds
    FROM customer_refunds cr
    JOIN shops s ON s.shop_id = cr.shop_id
    WHERE s.owner = $1
    GROUP BY 1
    ORDER BY 1
`;

// The listings that earned the most, best first. Bounded, because this is a
// leaderboard and a list of every listing the shop has ever sold is not one.
const TOP_LISTINGS = `
    SELECT p.prod_id, p.name AS listing_name, s.name AS shop_name,
           SUM(oi.quantity)::int AS units,
           SUM(oi.quantity * oi.unit_price)::numeric(12,2) AS revenue
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    JOIN products p ON p.prod_id = oi.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    WHERE s.owner = $1 AND o.order_status = 'delivered'
    GROUP BY p.prod_id, p.name, s.name
    ORDER BY revenue DESC, p.prod_id
    LIMIT 10
`;

// The same figures the balance is built from, so the statistics page reconciles
// against the balance page rather than merely looking plausible beside it. The
// identity these satisfy is
//   balance = delivered revenue + top-ups − purchases − customer refunds + admin refunds
// and it is asserted in the schema test.
const OWNED_RECONCILIATION = `
    SELECT
      (SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric(12,2)
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       JOIN products p ON p.prod_id = oi.prod_id
       JOIN shops s ON s.shop_id = p.shop_id
       WHERE s.owner = $1 AND o.order_status = 'delivered') AS delivered_revenue,
      (SELECT COALESCE(SUM(oi.quantity), 0)::int
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       JOIN products p ON p.prod_id = oi.prod_id
       JOIN shops s ON s.shop_id = p.shop_id
       WHERE s.owner = $1 AND o.order_status = 'delivered') AS units_sold,
      (SELECT COUNT(DISTINCT o.order_id)::int
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.order_id
       JOIN products p ON p.prod_id = oi.prod_id
       JOIN shops s ON s.shop_id = p.shop_id
       WHERE s.owner = $1 AND o.order_status = 'delivered') AS delivered_orders,
      (SELECT COALESCE(SUM(t.amount), 0)::numeric(12,2)
       FROM shop_topups t JOIN shops s ON s.shop_id = t.shop_id
       WHERE s.owner = $1) AS recharged,
      (SELECT COALESCE(SUM(sp.quantity * sp.wholesale_unit_price), 0)::numeric(12,2)
       FROM shop_purchases sp JOIN shops s ON s.shop_id = sp.shop_id
       WHERE s.owner = $1) AS wholesale_spend,
      (SELECT COALESCE(SUM(cr.amount), 0)::numeric(12,2)
       FROM customer_refunds cr JOIN shops s ON s.shop_id = cr.shop_id
       WHERE s.owner = $1) AS refunded_to_customers,
      (SELECT COALESCE(SUM(vr.amount), 0)::numeric(12,2)
       FROM vendor_refunds vr JOIN shops s ON s.shop_id = vr.shop_id
       WHERE s.owner = $1) AS refunds_received,
      (SELECT COALESCE(SUM(s.balance), 0)::numeric(12,2)
       FROM shops s WHERE s.owner = $1) AS balance_total
`;

module.exports = {
  CUSTOMER_REFUNDS_BY_PERIOD,
  DELIVERED_REVENUE_BY_PERIOD,
  OWNED_RECONCILIATION,
  PERIODS,
  TOP_LISTINGS,
};
