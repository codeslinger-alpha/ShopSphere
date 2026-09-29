const pool = require("../db/pool");
const transaction = require("../db/transaction");
const v = require("../utils/input");
const q = require("../db/queries/orderQueries");
const { CREATE_LOCATION } = require("../db/queries/authQueries");

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

// Atomically buy the locked cart rows at current listing prices, record a cash
// payment, and remove the purchased rows. Any failure rolls back all changes.
async function placeOrder(req, res) {
  const userId = req.user.user_id;
  const order = await transaction(async (client) => {
    // Snapshot the cart before waiting for its row locks. Items added while a
    // checkout is waiting belong to the customer's next order, not this one.
    const productIds = (
      await client.query(q.CART_PRODUCT_IDS, [userId])
    ).rows.map((row) => row.prod_id);
    const cart = (
      await client.query(q.CART_FOR_ORDER, [userId, productIds])
    ).rows;
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
    // A courier claims an order from the open board after it is placed. This
    // keeps an order visible when nobody was available at checkout time.
    const created = (
      await client.query(q.CREATE_ORDER, [userId, shippingAddress])
    ).rows[0];

    for (const item of cart) {
      await client.query(q.CREATE_ORDER_ITEM, [
        created.order_id,
        item.prod_id,
        item.quantity,
        item.unit_price,
      ]);
    }

    // Prices the trip from the goods total the trigger has just written, so the
    // customer's delivery charge and the courier's pay are the same number.
    await client.query(q.RECORD_DELIVERY_COST, [
      created.order_id,
      q.COURIER_BASE_FEE,
      q.COURIER_RATE,
    ]);

    // Read back rather than summed here: trg_order_items_recalc_total has just
    // written total_amount, and the database is the authority on it.
    const totals = (await client.query(q.ORDER_TOTALS, [created.order_id])).rows[0];
    const payment = (
      await client.query(q.CREATE_PAYMENT, [created.order_id])
    ).rows[0];

    await client.query(q.CLEAR_CART, [userId, cart.map((item) => item.prod_id)]);

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
    return res.status(404).json({ message: "Order not found." });
  const items = (await pool.query(q.GET_ORDER_ITEMS, [orderId])).rows;
  return res.json({ ...order, items });
}

async function cancelOrder(req, res) {
  const orderId = v.id(req.params.orderId, "Order");
  const cancelled = (
    await transaction.query(q.CANCEL_ORDER, [orderId, req.user.user_id])
  ).rows[0];

  if (!cancelled) {
    const existing = (
      await pool.query(q.GET_ORDER_STATUS, [orderId, req.user.user_id])
    ).rows[0];
    if (!existing)
      return res.status(404).json({ message: "Order not found." });
    return res.status(409).json({
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

async function listOpenOrders(req, res) {
  const orders = (
    await pool.query(q.LIST_OPEN_ORDERS, [req.user.user_id])
  ).rows;

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

async function claimOrder(req, res) {
  const orderId = v.id(req.params.orderId, "Order");
  const order = (
    await transaction.query(q.CLAIM_ORDER, [orderId, req.user.user_id])
  ).rows[0];
  if (!order) v.fail(409, "That order is no longer available to take.");

  return res.json({
    message: `Order #${order.order_id} is yours. Collect the parcel and mark it shipped.`,
    order,
  });
}

async function advanceDelivery(req, res) {
  const orderId = v.id(req.params.orderId, "Order");
  const target = req.body?.order_status;
  if (!["shipped", "delivered"].includes(target))
    v.fail(400, "An order can be marked shipped or delivered.");

  const order = await transaction(async (client) => {
    const advanced = target === "delivered"
      ? (await client.query(q.SETTLE_DELIVERY, [orderId, req.user.user_id]))
          .rows[0].result
      : (await client.query(q.SHIP_ORDER, [orderId, req.user.user_id])).rows[0];

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

    return { payment: null, courier_earnings: null, ...advanced };
  });

  if (!order)
    return res.status(404).json({ message: "Order not found." });

  return res.json({
    message:
      target === "delivered"
        ? "Order delivered. The cash payment is now settled."
        : "Order marked as shipped.",
    order,
  });
}

module.exports = {
  advanceDelivery,
  cancelOrder,
  claimOrder,
  getOrder,
  listDeliveries,
  listOpenOrders,
  listOrders,
  placeOrder,
};
