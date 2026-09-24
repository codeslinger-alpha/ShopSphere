const pool = require("../config/db");
const transaction = require("../utils/transaction");
const v = require("../utils/input");
const q = require("../queries/orderQueries");
const { CREATE_LOCATION } = require("../queries/authQueries");
const { parsePositiveInteger } = require("../utils/validation");

// Only these two moves exist for a courier, and each one is only legal from the
// status before it. fn_guard_order_transition enforces the same table in the
// database; stating it here too is what lets the endpoint answer 400 to a typo
// rather than letting a constraint violation surface.
const COURIER_TRANSITIONS = { shipped: "pending", delivered: "shipped" };

// Said to the customer whose checkout lost the race. The distinction matters: a
// sold-out listing can be fixed by lowering the quantity, one that went off sale
// cannot.
function claimFailureMessage(item, detail) {
  const label = `"${item.name}"`;
  const onSale =
    detail &&
    !detail.discontinued &&
    detail.shop_status === "active" &&
    detail.master_status === "available";
  if (!onSale)
    return `${label} went off sale while you were checking out. Remove it from your cart and try again.`;
  const left = detail.in_stock > 0 ? `${detail.in_stock} left` : "none left";
  return `${label} sold out while you were checking out — ${left} at ${detail.shop_name}. Adjust your cart and try again.`;
}

// An address entered at checkout becomes a new locations row rather than an edit
// to the customer's profile, so an order keeps the address it was actually sent
// to even after the customer moves. Profile edits follow the same rule.
async function resolveShippingAddress(client, userId, body) {
  if (String(body.street_address ?? "").trim()) {
    const created = await client.query(CREATE_LOCATION, v.address(body));
    return created.rows[0].location_id;
  }
  const profile = (await client.query(q.USER_PROFILE_ADDRESS, [userId])).rows[0];
  if (!profile || profile.address === null)
    v.fail(
      400,
      "Add a delivery address to your profile, or enter one at checkout.",
    );
  return profile.address;
}

// Places the customer's cart as an order, in cash on delivery.
//
// The cart is the only input: the listings and quantities come from it, and the
// prices are the snapshot the customer was shown. Everything below runs in one
// transaction, so an order either exists complete with its stock claimed, its
// items, its payment row and an emptied cart — or nothing happened at all.
async function placeOrder(req, res) {
  const userId = req.user.user_id;
  const order = await transaction(async (client) => {
    const cart = (await client.query(q.CART_FOR_ORDER, [userId])).rows;
    if (cart.length === 0)
      v.fail(400, "Your cart is empty. Add something to it before checking out.");

    // Ordered by prod_id by the query itself, so every concurrent checkout walks
    // the listings in the same sequence and cannot deadlock against another.
    for (const item of cart) {
      const claimed = await client.query(q.CLAIM_STOCK, [
        item.prod_id,
        item.quantity,
      ]);
      if (claimed.rowCount === 0) {
        const detail = (
          await client.query(q.CLAIM_FAILURE_DETAIL, [item.prod_id])
        ).rows[0];
        v.fail(409, claimFailureMessage(item, detail));
      }
    }

    const shippingAddress = await resolveShippingAddress(client, userId, req.body || {});
    // Nobody available is a legitimate outcome, not a failure: the order waits
    // unassigned, exactly as the seeded pending order does.
    const courier = (await client.query(q.FIND_AVAILABLE_COURIER)).rows[0];

    const created = (
      await client.query(q.CREATE_ORDER, [
        userId,
        shippingAddress,
        courier ? courier.delivery_person_id : null,
      ])
    ).rows[0];

    for (const item of cart) {
      await client.query(q.CREATE_ORDER_ITEM, [
        created.order_id,
        item.prod_id,
        item.quantity,
        item.unit_price,
        q.PLATFORM_COMMISSION_RATE,
      ]);
    }

    // Each line kept its own commission above; this rolls them onto the order so
    // a revenue report does not have to join order_items to answer "what did we
    // make on this order". Summed in SQL, not in JavaScript, because the rounded
    // per-line figures are the authority and the order must not disagree with
    // its own lines. The result is not returned to the customer: the platform's
    // margin is not the buyer's business, and Step 6 reads it back as an admin.
    await client.query(q.RECORD_PLATFORM_COMMISSION, [created.order_id]);

    // Read back rather than summed here: trg_order_items_recalc_total has just
    // written total_amount, and the database is the authority on it.
    const totals = (await client.query(q.ORDER_TOTALS, [created.order_id])).rows[0];
    const payment = (
      await client.query(q.CREATE_PAYMENT, [
        created.order_id,
        Number(totals.total_amount) + Number(totals.delivery_cost),
      ])
    ).rows[0];

    await client.query(q.CLEAR_CART, [userId]);

    return {
      ...created,
      total_amount: totals.total_amount,
      delivery_cost: totals.delivery_cost,
      payment,
      items: cart.map((item) => ({
        prod_id: item.prod_id,
        name: item.name,
        shop_name: item.shop_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
    };
  });

  return res.status(201).json({
    // 201 Created: a new account or collection item was added.
    message: "Order placed. Pay in cash when it arrives.",
    order,
  });
}

async function listOrders(req, res) {
  const orders = (await pool.query(q.LIST_ORDERS_BY_USER, [req.user.user_id]))
    .rows;
  return res.json(orders);
}

async function getOrder(req, res) {
  const orderId = v.id(req.params.orderId, "Order");
  const order = (
    await pool.query(q.GET_ORDER_BY_USER, [orderId, req.user.user_id])
  ).rows[0];
  if (!order)
    return res.status(404).json({ message: "Order not found." }); // 404 Not Found: the requested route or record could not be found.
  const items = (await pool.query(q.GET_ORDER_ITEMS, [orderId])).rows;
  return res.json({ ...order, items });
}

async function cancelOrder(req, res) {
  const orderId = v.id(req.params.orderId, "Order");
  const cancelled = (
    await pool.query(q.CANCEL_ORDER, [orderId, req.user.user_id])
  ).rows[0];

  if (!cancelled) {
    const existing = (
      await pool.query(q.GET_ORDER_STATUS, [orderId, req.user.user_id])
    ).rows[0];
    if (!existing)
      return res.status(404).json({ message: "Order not found." }); // 404 Not Found: the requested route or record could not be found.
    return res.status(409).json({
      // 409 Conflict: the request conflicts with existing data or product availability.
      message: `This order is already ${existing.order_status} and cannot be cancelled.`,
    });
  }

  // The stock is already back: fn_cleanup_cancelled_order returns it, and fails
  // the pending payment, as part of this very update.
  return res.json({
    message: "Order cancelled. The stock has been returned to the shops.",
    order: cancelled,
  });
}

// =========================================================
// Delivery
// =========================================================

async function listDeliveries(req, res) {
  const orders = (
    await pool.query(q.LIST_DELIVERIES_FOR_COURIER, [req.user.user_id])
  ).rows;

  // A courier needs to know what is in each parcel, so the items come back with
  // the orders in one extra query rather than one per order.
  if (orders.length) {
    const items = (
      await pool.query(q.GET_ITEMS_FOR_ORDERS, [
        orders.map((order) => order.order_id),
      ])
    ).rows;
    for (const order of orders)
      order.items = items.filter((item) => item.order_id === order.order_id);
  }

  return res.json(orders);
}

async function advanceDelivery(req, res) {
  const orderId = v.id(req.params.orderId, "Order");
  const target = req.body?.order_status;
  const expected = COURIER_TRANSITIONS[target];
  if (!expected)
    v.fail(400, "An order can be marked shipped or delivered.");

  const order = await transaction(async (client) => {
    const advanced = (
      await client.query(q.ADVANCE_ORDER_STATUS, [
        orderId,
        req.user.user_id,
        target,
        expected,
      ])
    ).rows[0];

    if (!advanced) {
      const assigned = (
        await client.query(q.GET_ASSIGNED_ORDER, [orderId, req.user.user_id])
      ).rows[0];
      if (!assigned)
        return null;
      v.fail(
        409,
        `This order is ${assigned.order_status}, so it cannot be marked ${target}.`,
      );
    }

    // Cash on delivery settles at the door: the order being delivered is the
    // moment the money exists, so the payment is completed with the same
    // timestamp the order was delivered at.
    let payment = null;
    let courierEarnings = null;
    if (target === "delivered") {
      payment =
        (
          await client.query(q.COMPLETE_PAYMENT, [
            orderId,
            advanced.delivered_at,
          ])
        ).rows[0] || null;

      // The courier is paid in the same breath, and the same reasoning covers
      // both writes: this branch is only reached on the transition that actually
      // happened, so neither the settlement nor the pay can be applied twice.
      // advanced.delivery_person_id is the courier who made that transition —
      // the compare-and-set matched on it, so it cannot be somebody else's.
      courierEarnings = (
        await client.query(q.CREDIT_COURIER_EARNINGS, [
          advanced.delivery_person_id,
          q.COURIER_BASE_FEE,
          q.COURIER_RATE,
          advanced.total_amount,
        ])
      ).rows[0];
    }

    return { ...advanced, payment, courier_earnings: courierEarnings };
  });

  if (!order)
    return res.status(404).json({ message: "Order not found." }); // 404 Not Found: the requested route or record could not be found.

  return res.json({
    message:
      target === "delivered"
        ? "Order delivered. The cash payment is now settled."
        : "Order marked as shipped.",
    order,
  });
}

module.exports = { advanceDelivery, cancelOrder, getOrder, listDeliveries, listOrders, placeOrder };
