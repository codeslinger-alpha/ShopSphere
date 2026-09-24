const pool = require("../config/db");
const { paginated, parseListQuery } = require("../utils/listQuery");
const q = require("../queries/paymentQueries");
// The vendor's wholesale purchases already have a query and a screen. This page
// reuses that read rather than writing a second one that could drift from it.
const vendor = require("../queries/vendorQueries");

// =========================================================
// Admin — the whole ledger
// =========================================================

async function listPayments(req, res) {
  const parsed = parseListQuery(req.query, {
    status: q.PAYMENT_STATUSES,
    method: q.PAYMENT_METHODS,
  });
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const { filters } = parsed;
  const result = await pool.query(q.buildPaymentListQuery(filters));
  return res.json(paginated(result.rows, filters.page, filters.limit));
}

async function listRefunds(req, res) {
  const parsed = parseListQuery(req.query, { reason: q.REFUND_REASONS });
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const { filters } = parsed;
  const result = await pool.query(q.buildRefundListQuery(filters));
  return res.json(paginated(result.rows, filters.page, filters.limit));
}

// =========================================================
// Vendor — their own books
// =========================================================

// Four lists and a set of totals, all keyed on the caller's own user id. Shop ids
// never enter into it: a vendor cannot ask for another shop's takings because
// there is no parameter in which to ask, which is a stronger guarantee than
// checking one.
async function vendorPayments(req, res) {
  const owner = req.user.user_id;

  const sales = (await pool.query(q.LIST_OWNED_SALES, [owner])).rows;
  const purchases = (await pool.query(vendor.LIST_OWNED_PURCHASES, [owner])).rows;
  const refunds = (await pool.query(q.LIST_OWNED_REFUNDS, [owner])).rows;
  const shops = (await pool.query(q.LIST_OWNED_EARNINGS, [owner])).rows;
  const totals = (await pool.query(q.OWNED_TOTALS, [owner])).rows[0];

  // The commission and the post-commission net are derived from what the totals
  // query already returned rather than re-read, so the headline figures and the
  // rows on the screen cannot disagree.
  const { gross_sales, commission_paid } = totals;
  return res.json({
    sales,
    purchases,
    refunds,
    shops,
    totals: {
      ...totals,
      net_sales: (Number(gross_sales) - Number(commission_paid)).toFixed(2),
    },
  });
}

// =========================================================
// Customer — their own payments
// =========================================================

async function accountPayments(req, res) {
  const payments = (
    await pool.query(q.LIST_OWNED_PAYMENTS, [req.user.user_id])
  ).rows;
  return res.json(payments);
}

module.exports = { accountPayments, listPayments, listRefunds, vendorPayments };
