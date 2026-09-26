const pool = require("../db/pool");
const transaction = require("../db/transaction");
const v = require("../utils/input");
const { CREATE_LOCATION } = require("../db/queries/authQueries");
const q = require("../db/queries/vendorQueries");
const sq = require("../db/queries/statisticsQueries");
async function shops(req, res) {
  res.json((await pool.query(q.LIST_OWNED_SHOPS, [req.user.user_id])).rows);
}
async function saveShop(req, res) {
  const b = req.body || {},
    id = req.params.shopId ? v.id(req.params.shopId) : null;
  const values = [
    v.string(b.name, "Shop name", 120, true),
    v.string(b.description, "Shop description", 20000),
    v.phone(b.phone_numbers),
    v.url(b.logo, "Logo URL"),
    v.url(b.cover_photo, "Cover photo URL"),
  ];
  // active_status is not read from the body. New shops start 'pending' and only
  // an administrator can approve, disable or restore one, so a vendor can never
  // activate their own shop or reverse a ban.
  const address = v.address(b);
  const shop = await transaction(async (c) => {
    if (
      id &&
      !(await c.query(q.OWNED_SHOP, [id, req.user.user_id])).rowCount
    )
      v.fail(404, "Your shop was not found.");
    const location = (await c.query(CREATE_LOCATION, address)).rows[0]
      .location_id;
    return (
      id
        ? await c.query(q.UPDATE_SHOP, [...values, location, id, req.user.user_id])
        : await c.query(q.CREATE_SHOP, [...values, location, req.user.user_id])
    ).rows[0];
  });
  const message = id
    ? "Shop saved."
    : "Shop submitted. An administrator will review it before it goes live.";
  res.status(id ? 200 : 201).json({ message, shop });
}
async function listings(req, res) {
  res.json((await pool.query(q.LIST_OWNED_LISTINGS, [req.user.user_id])).rows);
}
async function purchases(req, res) {
  res.json((await pool.query(q.LIST_OWNED_PURCHASES, [req.user.user_id])).rows);
}
async function buy(req, res) {
  const b = req.body || {},
    shopId = v.id(b.shop_id, "Shop"),
    masterId = v.id(b.master_prod_id, "Master product"),
    quantity = v.id(b.quantity, "Quantity"),
    price = v.money(b.unit_price),
    description = v.string(b.description, "Seller description", 20000);
  const bought = await transaction(async (c) => {
    if (
      !(await c.query(q.ACTIVE_OWNED_SHOP, [shopId, req.user.user_id]))
        .rowCount
    )
      v.fail(404, "Your active shop was not found.");
    const master = (await c.query(q.AVAILABLE_MASTER, [masterId])).rows[0];
    if (!master) v.fail(404, "Available master product not found.");
    const existing = (
      await c.query(q.LISTING_FOR_MASTER, [shopId, masterId])
    ).rows[0];
    if (existing && existing.in_stock + quantity > 2147483647)
      v.fail(409, "This purchase exceeds the inventory limit.");

    // What the stock costs, priced from the master's wholesale price rather than
    // from anything the caller sent. The debit comes before the purchase row so a
    // shop that cannot afford the stock never gets a purchase recorded for it —
    // the transaction would roll it back either way, but a refusal is clearer
    // than a write that is about to be undone.
    const cost = (Number(master.wholesale_price) * quantity).toFixed(2);
    const debited = await c.query(q.DEBIT_SHOP_BALANCE, [
      shopId,
      cost,
      req.user.user_id,
    ]);
    if (debited.rowCount === 0)
      v.fail(
        409,
        `Your balance does not cover this purchase. It costs ${cost} at the wholesale price. Recharge your balance and try again.`,
      );

    await c.query(q.CREATE_PURCHASE, [
      shopId,
      masterId,
      quantity,
      master.wholesale_price,
    ]);
    const listing = (
      existing
        ? await c.query(q.RESTOCK_LISTING, [
            quantity,
            price,
            description,
            master.name,
            master.images,
            existing.prod_id,
          ])
        : await c.query(q.CREATE_LISTING, [
            master.name,
            master.images,
            masterId,
            description,
            shopId,
            quantity,
            price,
          ])
    ).rows[0];
    return { listing, cost, balance: debited.rows[0].balance };
  });
  res.status(201).json({
    message: `Wholesale purchase recorded and listing stocked. ${bought.cost} was taken from your shop balance.`,
    listing: bought.listing,
    balance: bought.balance,
  });
}
async function updateListing(req, res) {
  const b = req.body || {};
  if (typeof b.discontinued !== "boolean")
    v.fail(400, "Listing discontinued status must be true or false.");
  const result = await transaction.query(q.UPDATE_OWNED_LISTING, [
    v.string(b.description, "Description", 20000),
    v.money(b.unit_price),
    b.discontinued,
    req.user.user_id,
    v.id(req.params.productId),
  ]);
  if (!result.rowCount) v.fail(404, "Your listing was not found.");
  res.json({ message: "Listing saved.", listing: result.rows[0] });
}
// The shop's balance and where it came from. The balance is a cached running
// total, so this returns the movements behind it as well — a number nobody can
// reconstruct is a number nobody can check.
async function balance(req, res) {
  const shopId = v.id(req.query.shop_id, "Shop");
  const owned = (
    await pool.query(q.OWNED_SHOP, [shopId, req.user.user_id])
  ).rows[0];
  if (!owned) v.fail(404, "Your shop was not found.");
  const shop = (await pool.query(q.SHOP_BALANCE, [shopId])).rows[0];
  const movements = (await pool.query(q.LIST_SHOP_MOVEMENTS, [shopId])).rows;
  return res.json({ ...shop, movements });
}

// A recharge credits the balance and records the top-up in one transaction, so
// the running total and its ledger cannot disagree.
//
// There is no payment gateway, and the response says so rather than implying a
// card was charged — the same honesty the wholesale purchase message used to
// carry. The amount is validated as money and is the only thing taken from the
// body; the balance itself is never accepted from the caller.
async function topUp(req, res) {
  const b = req.body || {};
  const shopId = v.id(b.shop_id, "Shop");
  const amount = v.money(b.amount, "Amount");
  const method = v.string(b.method || "card", "Method", 20, true);
  if (!["card", "bank_transfer", "cash"].includes(method))
    v.fail(400, "Method must be one of card, bank_transfer, cash.");
  if (Number(amount) <= 0) v.fail(400, "A recharge must be for more than zero.");

  const result = await transaction(async (c) => {
    const credited = await c.query(q.CREDIT_SHOP_BALANCE, [
      shopId,
      amount,
      req.user.user_id,
    ]);
    // Ownership is in the predicate, so nothing to distinguish here: a shop that
    // is not the caller's simply does not match.
    if (credited.rowCount === 0) v.fail(404, "Your shop was not found.");
    const topup = (
      await c.query(q.CREATE_TOPUP, [shopId, amount, method])
    ).rows[0];
    return { topup, balance: credited.rows[0].balance };
  });

  return res.status(201).json({
    message: `Balance recharged by ${amount}. No card was charged — this records the top-up only.`,
    topup: result.topup,
    balance: result.balance,
  });
}

// What the shop has earned over time, and off which listings.
//
// The two series are merged here rather than joined in SQL: revenue comes from
// delivered orders and refunds from a different table, and a FULL OUTER JOIN of
// two grouped queries to line up their buckets is a great deal of SQL to do what
// one map does. Every period either series mentions gets a row, so a month with
// refunds and no sales still appears rather than being silently absent.
//
// `group_by` is checked against the closed set the queries declare before it
// reaches date_trunc. It is a bound parameter, so this is defence in depth rather
// than the only thing preventing an injection — but a value that is not one of
// the three would otherwise reach the database and fail there, which is a worse
// way to learn about a typo in a query string.
async function statistics(req, res) {
  const groupBy = String(req.query.group_by || "month");
  if (!sq.PERIODS.includes(groupBy))
    v.fail(400, `Group by must be one of ${sq.PERIODS.join(", ")}.`);

  const [revenue, refunds, top, totals] = await Promise.all([
    pool.query(sq.DELIVERED_REVENUE_BY_PERIOD, [req.user.user_id, groupBy]),
    pool.query(sq.CUSTOMER_REFUNDS_BY_PERIOD, [req.user.user_id, groupBy]),
    pool.query(sq.TOP_LISTINGS, [req.user.user_id]),
    pool.query(sq.OWNED_RECONCILIATION, [req.user.user_id]),
  ]);

  const periods = new Map();
  const bucket = (period) =>
    periods.get(period) || { period, units: 0, orders: 0, revenue: "0.00", refunds: "0.00" };
  // A row with revenue `null` and a refund beside it is a period that only had
  // returns in it, which is a real thing for a shop to want to see.
  for (const row of revenue.rows) {
    const entry = bucket(row.period);
    entry.units = row.units;
    entry.orders = row.orders;
    entry.revenue = row.revenue;
    periods.set(row.period, entry);
  }
  for (const row of refunds.rows) {
    const entry = bucket(row.period);
    entry.refunds = row.refunds;
    periods.set(row.period, entry);
  }

  res.json({
    group_by: groupBy,
    series: [...periods.values()].sort((a, b) =>
      a.period.localeCompare(b.period),
    ),
    top_listings: top.rows,
    totals: totals.rows[0],
  });
}

module.exports = {
  balance,
  buy,
  listings,
  purchases,
  saveShop,
  shops,
  statistics,
  topUp,
  updateListing,
};
