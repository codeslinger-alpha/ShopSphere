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
//
// Money leaves here as a two-place string. A SUM has no declared scale for
// src/db/execute.js to read, so each one is TO_CHARed to the two places the chart
// and the tables show; PostgreSQL said `::numeric(12,2)` and got the same string.

// date_trunc took its field as text, so the period was a bound parameter rather
// than string-stitched SQL. Oracle has TRUNC, whose format is one of its own
// codes rather than the word PostgreSQL used: 'IW' is the ISO week, which begins
// on the Monday date_trunc('week') begins on, and the day and the month are the
// same both ways. The controller still checks the parameter against the closed
// set below, because the period is a choice the client makes and this file
// should not be the only thing standing between a query string and the database.
const PERIODS = ["day", "week", "month"];

const asMoney = (expression) => `TO_CHAR(${expression}, 'FM9999999990.00')`;

// A bucket of one timestamp, chosen by the period parameter.
const bucket = (column) => `CASE WHEN :2 = 'day' THEN TRUNC(${column})
      WHEN :2 = 'week' THEN TRUNC(${column}, 'IW')
      WHEN :2 = 'month' THEN TRUNC(${column}, 'MM') END`;

// Revenue per period for delivered orders. The period comes back as the date the
// bucket starts — a week is labelled by its Monday — because a chart needs
// something sortable and a label like "2026-W31" is not.
//
// The bucket is computed by an inline view rather than repeated in a GROUP BY.
// Oracle will not group by a select-list alias, and writing the CASE three times
// — once to select, once to group, once to order — is three chances for the
// three to drift apart.
const DELIVERED_REVENUE_BY_PERIOD = `
    SELECT TO_CHAR(period, 'YYYY-MM-DD') AS period,
           SUM(quantity) AS units,
           ${asMoney("SUM(quantity * unit_price)")} AS revenue,
           COUNT(DISTINCT order_id) AS orders
    FROM (
      SELECT ${bucket("o.delivered_at")} AS period,
             oi.quantity, oi.unit_price, o.order_id
      FROM order_items oi
      JOIN orders o ON o.order_id = oi.order_id
      JOIN products p ON p.prod_id = oi.prod_id
      JOIN shops s ON s.shop_id = p.shop_id
      WHERE s.owner = :1 AND o.order_status = 'delivered'
        AND o.delivered_at IS NOT NULL
    )
    GROUP BY period
    ORDER BY period
`;

// What the shop paid back to customers, bucketed the same way. Read from
// customer_refunds rather than from the returns it came from: this table is the
// money, and a return that was requested on one day and accepted on another
// belongs in the bucket where the money actually moved.
const CUSTOMER_REFUNDS_BY_PERIOD = `
    SELECT TO_CHAR(period, 'YYYY-MM-DD') AS period,
           ${asMoney("SUM(amount)")} AS refunds
    FROM (
      SELECT ${bucket("cr.created_at")} AS period, cr.amount
      FROM customer_refunds cr
      JOIN shops s ON s.shop_id = cr.shop_id
      WHERE s.owner = :1
    )
    GROUP BY period
    ORDER BY period
`;

// The listings that earned the most, best first. Bounded, because this is a
// leaderboard and a list of every listing the shop has ever sold is not one.
// FETCH FIRST is Oracle's LIMIT.
const TOP_LISTINGS = `
    SELECT p.prod_id, p.name AS listing_name, s.name AS shop_name,
           SUM(oi.quantity) AS units,
           ${asMoney("SUM(oi.quantity * oi.unit_price)")} AS revenue
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    JOIN products p ON p.prod_id = oi.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    WHERE s.owner = :1 AND o.order_status = 'delivered'
    GROUP BY p.prod_id, p.name, s.name
    ORDER BY SUM(oi.quantity * oi.unit_price) DESC, p.prod_id
    FETCH FIRST 10 ROWS ONLY
`;

// The same figures the balance is built from, so the statistics page reconciles
// against the balance page rather than merely looking plausible beside it. The
// identity these satisfy is
//   balance = delivered revenue + top-ups − purchases − customer refunds + admin refunds
// and it is asserted in the schema test.
//
// One row of scalars, which is a SELECT with no table of its own — hence `FROM
// dual`, Oracle's stand-in for the FROM clause PostgreSQL let it go without.
// Every money figure is a SUM and so TO_CHARed; the three counts are numbers.
const OWNED_RECONCILIATION = `
    SELECT
      (SELECT ${asMoney("COALESCE(SUM(oi.quantity * oi.unit_price), 0)")}
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       JOIN products p ON p.prod_id = oi.prod_id
       JOIN shops s ON s.shop_id = p.shop_id
       WHERE s.owner = :1 AND o.order_status = 'delivered') AS delivered_revenue,
      (SELECT COALESCE(SUM(oi.quantity), 0)
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       JOIN products p ON p.prod_id = oi.prod_id
       JOIN shops s ON s.shop_id = p.shop_id
       WHERE s.owner = :1 AND o.order_status = 'delivered') AS units_sold,
      (SELECT COUNT(DISTINCT o.order_id)
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.order_id
       JOIN products p ON p.prod_id = oi.prod_id
       JOIN shops s ON s.shop_id = p.shop_id
       WHERE s.owner = :1 AND o.order_status = 'delivered') AS delivered_orders,
      (SELECT ${asMoney("COALESCE(SUM(t.amount), 0)")}
       FROM shop_topups t JOIN shops s ON s.shop_id = t.shop_id
       WHERE s.owner = :1) AS recharged,
      (SELECT ${asMoney("COALESCE(SUM(sp.quantity * sp.wholesale_unit_price), 0)")}
       FROM shop_purchases sp JOIN shops s ON s.shop_id = sp.shop_id
       WHERE s.owner = :1) AS wholesale_spend,
      (SELECT ${asMoney("COALESCE(SUM(cr.amount), 0)")}
       FROM customer_refunds cr JOIN shops s ON s.shop_id = cr.shop_id
       WHERE s.owner = :1) AS refunded_to_customers,
      (SELECT ${asMoney("COALESCE(SUM(vr.amount), 0)")}
       FROM vendor_refunds vr JOIN shops s ON s.shop_id = vr.shop_id
       WHERE s.owner = :1) AS refunds_received,
      (SELECT ${asMoney("COALESCE(SUM(s.balance), 0)")}
       FROM shops s WHERE s.owner = :1) AS balance_total
    FROM dual
`;

module.exports = {
  CUSTOMER_REFUNDS_BY_PERIOD,
  DELIVERED_REVENUE_BY_PERIOD,
  OWNED_RECONCILIATION,
  PERIODS,
  TOP_LISTINGS,
};
