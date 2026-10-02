const pool = require("../db/pool");
const v = require("../utils/input");
const { paginated, parseListQuery } = require("../utils/listQuery");
const q = require("../db/queries/paymentQueries");
// The vendor's wholesale purchases already have a query and a screen. This page
// reuses that read rather than writing a second one that could drift from it.
const vendor = require("../db/queries/vendorQueries");

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

// A sale is worth its line subtotal in full. There is no commission between the
// customer's payment and the shop, so gross_sales is also what the shop nets and
// there is no second figure to derive.
async function vendorPayments(req, res) {
  const owner = req.user.user_id;
  const shopId = req.query.shop_id ? v.id(req.query.shop_id, "Shop") : null;

  if (shopId) {
    if (!(await pool.query(vendor.OWNED_SHOP, [shopId, owner])).rowCount)
      v.fail(404, "Your shop was not found.");
    const sales = (await pool.query(q.LIST_OWNED_SALES_FOR_SHOP, [owner, shopId])).rows;
    const purchases = (await pool.query(vendor.LIST_OWNED_PURCHASES_FOR_SHOP, [owner, shopId])).rows;
    const refunds = (await pool.query(q.LIST_OWNED_REFUNDS_FOR_SHOP, [owner, shopId])).rows;
    const shops = (await pool.query(q.LIST_OWNED_BALANCES_FOR_SHOP, [owner, shopId])).rows;
    const totals = (await pool.query(q.OWNED_TOTALS_FOR_SHOP, [owner, shopId])).rows[0];
    return res.json({ sales, purchases, refunds, shops, totals });
  }

  const sales = (await pool.query(q.LIST_OWNED_SALES, [owner])).rows;
  const purchases = (await pool.query(vendor.LIST_OWNED_PURCHASES, [owner])).rows;
  const refunds = (await pool.query(q.LIST_OWNED_REFUNDS, [owner])).rows;
  const shops = (await pool.query(q.LIST_OWNED_BALANCES, [owner])).rows;
  const totals = (await pool.query(q.OWNED_TOTALS, [owner])).rows[0];

  return res.json({ sales, purchases, refunds, shops, totals });
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
