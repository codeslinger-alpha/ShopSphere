const pool = require("../db/pool");
const transaction = require("../db/transaction");
const v = require("../utils/input");
const q = require("../db/queries/returnQueries");

// Customer returns, from the request to the restock.
//
// The shape of the flow is: the customer asks, the vendor decides, a courier
// picks the parcel up, and the shop puts it back on the shelf. Four people touch
// it and each of them can only move it one step, so every handler here is a
// single transition rather than a general "update the return" endpoint. A general
// one would have to decide which fields the caller is allowed to set, and the
// answer would be "none of them" — the only thing a caller chooses is which step
// they are taking.
//
// Money and goods therefore move in different handlers on purpose. Approving
// debits the shop and writes the refund; restocking is what puts the units back
// in stock. Until the parcel is physically back the shop cannot sell it, and
// until the vendor accepts, nobody is owed anything.

// The customer's request. refund_amount is computed by the INSERT from the order
// line's stored price, so the amount owed never passes through the client.
async function request(req, res) {
  const b = req.body || {};
  const orderId = v.id(b.order_id, "Order"),
    prodId = v.id(b.prod_id, "Listing"),
    quantity = v.id(b.quantity, "Quantity");
  const reason = v.string(b.reason, "Reason", 2000, true);

  const line = (
    await pool.query(q.RETURNABLE_LINE, [orderId, prodId, req.user.user_id])
  ).rows[0];
  // Said here rather than left to the trigger so the customer gets a sentence
  // about their order instead of a constraint violation. The trigger is still the
  // enforcement; this is only the explanation.
  if (!line) v.fail(404, "That listing is not on one of your orders.");
  if (line.order_status !== "delivered")
    v.fail(409, "Only a delivered order can be returned.");

  const created = (
    await transaction.query(q.CREATE_RETURN, [
      orderId,
      prodId,
      req.user.user_id,
      quantity,
      reason,
    ])
  ).rows[0];
  // The INSERT selects from order_items, so a line that vanished between the read
  // above and here produces no row rather than an error. A listing that already
  // has an open return is a different thing: the partial unique index rejects it,
  // and 23505 becomes a 409 in the error handler.
  if (!created)
    v.fail(404, "That listing is not on one of your orders.");

  res.status(201).json({
    message: `${line.listing_name} is with ${line.shop_name} for review. If they accept it, a courier will collect it and you will be refunded ${created.refund_amount}.`,
    return: created,
  });
}

async function mine(req, res) {
  res.json(
    (await pool.query(q.LIST_RETURNS_FOR_CUSTOMER, [req.user.user_id])).rows,
  );
}

async function forVendor(req, res) {
  res.json(
    (await pool.query(q.LIST_RETURNS_FOR_VENDOR, [req.user.user_id])).rows,
  );
}

// Accepting the return. This is the moment the shop takes on the obligation, so
// it is also the moment the money moves: the balance is debited and the refund
// recorded, both in one transaction, so a refund can never exist without its
// debit. The debit is unconditional — a vendor's empty balance is not a reason to
// keep a customer's money.
async function approve(req, res) {
  const b = req.body || {};
  const returnId = v.id(req.params.returnId, "Return");
  const note = v.string(b.decision_note, "Decision note", 2000);

  const decided = await transaction(async (c) => {
    const approved = await c.query(q.APPROVE_RETURN, [
      returnId,
      req.user.user_id,
      note,
    ]);
    // Already approved, rejected, or somebody else's shop. The status is in the
    // predicate, so two vendors clicking at once cannot both charge the shop.
    if (approved.rowCount === 0)
      v.fail(409, "That return is not waiting for your decision.");

    const row = approved.rows[0];
    const charged = (
      await c.query(q.CHARGE_SHOP_BALANCE, [row.shop_id, row.refund_amount])
    ).rows[0];
    await c.query(q.CREATE_CUSTOMER_REFUND, [
      row.return_id,
      row.order_id,
      row.user_id,
      row.shop_id,
      row.refund_amount,
    ]);
    return { row, balance: charged.balance };
  });

  res.json({
    message: `Return accepted. ${decided.row.refund_amount} was refunded to the customer from your balance. A courier will collect the parcel; the units go back on sale when you mark it restocked.`,
    return_id: decided.row.return_id,
    refund_amount: decided.row.refund_amount,
    balance: decided.balance,
  });
}

// The other decision. It moves no money and no stock, and it is not the end of
// the line: the customer may ask again, which is why the record stays.
async function reject(req, res) {
  const b = req.body || {};
  const note = v.string(b.decision_note, "Decision note", 2000, true);
  const result = await transaction.query(q.REJECT_RETURN, [
    v.id(req.params.returnId, "Return"),
    req.user.user_id,
    note,
  ]);
  if (result.rowCount === 0)
    v.fail(409, "That return is not waiting for your decision.");
  res.json({ message: "Return declined. Nothing was refunded." });
}

async function forCourier(req, res) {
  res.json(
    (await pool.query(q.LIST_RETURNS_FOR_COURIER, [req.user.user_id])).rows,
  );
}

// Picking the parcel up. Any active courier may do it, not only the one who
// delivered the order — the original courier may since have gone unavailable or
// been disabled, and a pickup only one person can perform is a pickup that can
// stall forever. The courier's own account being active is the predicate; whether
// they are free right now is not, since a courier on another delivery is still
// allowed to take this one.
async function collect(req, res) {
  const result = await transaction.query(q.COLLECT_RETURN, [
    v.id(req.params.returnId, "Return"),
    req.user.user_id,
  ]);
  if (result.rowCount === 0)
    v.fail(409, "That return is not waiting to be collected.");
  res.json({
    message:
      "Parcel collected. The shop will put the units back on sale when they have it.",
  });
}

// Back on the shelf. The units return to stock here and only here, because this
// is the first moment the shop can actually sell them again — restocking at
// collection would list goods that are still in a courier's van.
async function restock(req, res) {
  const returnId = v.id(req.params.returnId, "Return");
  const done = await transaction(async (c) => {
    const marked = await c.query(q.MARK_RESTOCKED, [
      returnId,
      req.user.user_id,
    ]);
    // Guarded on 'collected', so a double-click cannot restock the same units
    // twice and hand the shop free inventory.
    if (marked.rowCount === 0)
      v.fail(409, "That return is not waiting to be restocked.");
    const row = marked.rows[0];
    const product = (
      await c.query(q.RESTOCK_PRODUCT, [row.prod_id, row.quantity])
    ).rows[0];
    return { row, product };
  });
  res.json({
    message: `${done.row.quantity} units are back in stock. Your balance was not changed again — the refund was paid when you accepted the return.`,
    return_id: done.row.return_id,
    in_stock: done.product.in_stock,
  });
}

module.exports = {
  approve,
  collect,
  forCourier,
  forVendor,
  mine,
  reject,
  request,
  restock,
};
