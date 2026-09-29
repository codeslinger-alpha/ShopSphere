// The courier's pay, and therefore the delivery charge the customer pays: the
// two are the same number now. A flat part makes a short delivery worth doing,
// the share makes a large one worth doing carefully. Applied at placement and
// stored on the order, so changing these changes future orders only.
const COURIER_BASE_FEE = 3;
const COURIER_RATE = 0.02;

// Lock the cart rows so concurrent checkouts cannot buy the same cart twice.
// Stable product order also gives stock claims a consistent lock order.
const CART_PRODUCT_IDS = `
    SELECT prod_id FROM cart_items WHERE user_id = $1 ORDER BY prod_id
`;
const CART_FOR_ORDER = `
    SELECT c.prod_id, c.quantity, p.name, p.unit_price, p.in_stock,
           s.name AS shop_name
    FROM cart_items c
    JOIN products p ON p.prod_id = c.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE c.user_id = $1 AND c.prod_id = ANY($2::int[])
    ORDER BY c.prod_id
    FOR UPDATE OF c
`;

// Predicate and stock decrement execute under one row lock; no read/write gap.
const CLAIM_STOCK = `
    UPDATE products p SET in_stock = p.in_stock - $2
    FROM shops s, master_products mp
    WHERE p.prod_id = $1
      AND p.discontinued = false
      AND p.in_stock >= $2
      AND s.shop_id = p.shop_id
      AND s.active_status = 'active'
      AND mp.master_prod_id = p.master_prod_id
      AND mp.active_status = 'available'
    RETURNING p.prod_id, p.in_stock
`;

// Read only after a claim fails, to say what is actually left. READ COMMITTED
// means this sees the committed result of whoever won the row.
const CLAIM_FAILURE_DETAIL = `
    SELECT p.name, p.in_stock, p.discontinued,
           s.name AS shop_name, s.active_status AS shop_status,
           mp.active_status AS master_status
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.prod_id = $1
`;

// The order-item trigger owns total_amount. A courier claims it afterwards.
const CREATE_ORDER = `
    INSERT INTO orders (user_id, shipping_address, delivery_person_id)
    VALUES ($1, $2, NULL)
    RETURNING order_id, order_status, delivery_person_id, shipping_address,
              delivery_cost, created_at
`;

// Freeze the price read during checkout, not the price from an earlier cart page.
const CREATE_ORDER_ITEM = `
    INSERT INTO order_items (order_id, prod_id, quantity, unit_price)
    VALUES ($1, $2, $3, $4)
`;

// Prices the trip and stores it on the order, which is what makes the courier's
// pay and the customer's delivery charge one number. This runs after the items
// because it is a share of total_amount, and total_amount is still 0 until
// trg_order_items_recalc_total has fired.
const RECORD_DELIVERY_COST = `
    UPDATE orders
    SET delivery_cost = ROUND($2::numeric + $3::numeric * total_amount, 2)
    WHERE order_id = $1
    RETURNING delivery_cost
`;

// The trigger has run by now, so this stored column is authoritative. Reading
// it avoids depending on a helper function that older initialized databases may
// not contain.
const ORDER_TOTALS = `
    SELECT total_amount, delivery_cost FROM orders WHERE order_id = $1
`;

// paid_at is set explicitly to NULL. The column defaults to CURRENT_TIMESTAMP,
// which would date a cash-on-delivery payment as paid the moment it was created —
// the opposite of what 'pending' means.
const CREATE_PAYMENT = `
    INSERT INTO payments (order_id, amount, payment_method, payment_status, paid_at)
    SELECT order_id, total_amount + delivery_cost, 'cash_on_delivery', 'pending', NULL
    FROM orders WHERE order_id = $1
    RETURNING transaction_id, amount, payment_method, payment_status, paid_at
`;

// Preserve products added after the checkout snapshot was read.
const CLEAR_CART = "DELETE FROM cart_items WHERE user_id = $1 AND prod_id = ANY($2::int[])";

// Where a checkout falls back to when the customer does not enter an address.
const USER_PROFILE_ADDRESS = "SELECT address FROM users WHERE user_id = $1";

// =========================================================
// Shared projections
// =========================================================

// Grouped by primary keys, which lets PostgreSQL allow the other columns of each
// joined table. One order has one address, one courier and (in this design) one
// payment; only order_items genuinely multiplies.
const ORDER_SUMMARY_COLUMNS = `
    o.order_id, o.order_status, o.total_amount, o.delivery_cost,
    o.created_at, o.delivered_at, o.shipping_address,
    l.street_address, l.city, l.state_province, l.postal_code,
    pay.transaction_id, pay.payment_status, pay.payment_method,
    pay.amount AS payment_amount, pay.paid_at,
    d.name AS delivery_person_name, d.phone_numbers AS delivery_person_phone,
    COUNT(oi.prod_id)::int AS item_count,
    COALESCE(SUM(oi.quantity), 0)::int AS item_quantity
`;
const ORDER_SUMMARY_JOINS = `
    FROM orders o
    JOIN locations l ON l.location_id = o.shipping_address
    LEFT JOIN payments pay ON pay.order_id = o.order_id
    LEFT JOIN users d ON d.user_id = o.delivery_person_id
    LEFT JOIN order_items oi ON oi.order_id = o.order_id
`;
const ORDER_SUMMARY_GROUP_BY = `
    GROUP BY o.order_id, l.location_id, pay.transaction_id, d.user_id
`;

const LIST_ORDERS_BY_USER = `
    SELECT ${ORDER_SUMMARY_COLUMNS}
    ${ORDER_SUMMARY_JOINS}
    WHERE o.user_id = $1
    ${ORDER_SUMMARY_GROUP_BY}
    ORDER BY o.created_at DESC, o.order_id DESC
`;

const GET_ORDER_BY_USER = `
    SELECT ${ORDER_SUMMARY_COLUMNS}
    ${ORDER_SUMMARY_JOINS}
    WHERE o.order_id = $1 AND o.user_id = $2
    ${ORDER_SUMMARY_GROUP_BY}
`;

const GET_ORDER_ITEMS = `
    SELECT oi.prod_id, oi.quantity, oi.unit_price,
           oi.quantity * oi.unit_price AS subtotal,
           p.name, p.images, p.discontinued, p.shop_id,
           s.name AS shop_name
    FROM order_items oi
    JOIN products p ON p.prod_id = oi.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    WHERE oi.order_id = $1
    ORDER BY s.name, p.name
`;

// =========================================================
// Cancellation
// =========================================================

// Only a pending order can be cancelled, and fn_guard_order_transition enforces
// that in the database too. The status is part of the predicate rather than read
// first and checked after, so two cancels racing cannot both restore stock:
// fn_cleanup_cancelled_order fires only on the transition that actually happens.
const CANCEL_ORDER = `
    UPDATE orders SET order_status = 'cancelled'
    WHERE order_id = $1 AND user_id = $2 AND order_status = 'pending'
    RETURNING order_id, order_status
`;

const GET_ORDER_STATUS = `
    SELECT o.order_id, o.order_status
    FROM orders o WHERE o.order_id = $1 AND o.user_id = $2
`;

// =========================================================
// Delivery
// =========================================================

// Couriers see customer contact details and only their own active deliveries.
const LIST_DELIVERIES_FOR_COURIER = `
    SELECT ${ORDER_SUMMARY_COLUMNS},
           u.name AS customer_name, u.phone_numbers AS customer_phone
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    JOIN locations l ON l.location_id = o.shipping_address
    LEFT JOIN payments pay ON pay.order_id = o.order_id
    LEFT JOIN users d ON d.user_id = o.delivery_person_id
    LEFT JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.delivery_person_id = $1 AND o.order_status IN ('pending', 'shipped')
    GROUP BY o.order_id, l.location_id, pay.transaction_id, d.user_id, u.user_id
    ORDER BY o.created_at, o.order_id
`;

// Pending orders are visible only to active couriers currently on duty. The
// guarded claim below makes accepting one safe when two couriers race for it.
const LIST_OPEN_ORDERS = `
    SELECT ${ORDER_SUMMARY_COLUMNS}
    ${ORDER_SUMMARY_JOINS}
    WHERE o.delivery_person_id IS NULL AND o.order_status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM delivery_personnel d
        JOIN users u ON u.user_id = d.delivery_person_id
        WHERE d.delivery_person_id = $1
          AND d.active_status = 'available'
          AND u.active_status = 'active'
      )
    ${ORDER_SUMMARY_GROUP_BY}
    ORDER BY o.created_at, o.order_id
`;

const CLAIM_ORDER = `
    UPDATE orders o SET delivery_person_id = $2
    FROM delivery_personnel d
    JOIN users u ON u.user_id = d.delivery_person_id
    WHERE o.order_id = $1
      AND o.delivery_person_id IS NULL
      AND o.order_status = 'pending'
      AND d.delivery_person_id = $2
      AND d.active_status = 'available'
      AND u.active_status = 'active'
    RETURNING o.order_id, o.order_status, o.delivery_person_id
`;

// Shipping is a single guarded write; delivery uses the multi-table procedure.
const SHIP_ORDER = `
    UPDATE orders SET order_status = 'shipped'
    WHERE order_id = $1 AND delivery_person_id = $2 AND order_status = 'pending'
    RETURNING order_id, order_status, delivered_at, total_amount, delivery_person_id
`;

const SETTLE_DELIVERY = "CALL settle_delivery($1, $2, NULL)";

// One round trip for every parcel on the run, rather than one per order.
const GET_ITEMS_FOR_ORDERS = `
    SELECT oi.order_id, oi.prod_id, oi.quantity,
           p.name, s.name AS shop_name
    FROM order_items oi
    JOIN products p ON p.prod_id = oi.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    WHERE oi.order_id = ANY($1::int[])
    ORDER BY s.name, p.name
`;

// Read only after SHIP_ORDER matches nothing, to tell "not yours" apart
// from "already moved on".
const GET_ASSIGNED_ORDER = `
    SELECT order_id, order_status FROM orders
    WHERE order_id = $1 AND delivery_person_id = $2
`;

module.exports = {
  CART_PRODUCT_IDS,
  SHIP_ORDER,
  CANCEL_ORDER,
  CART_FOR_ORDER,
  CLAIM_FAILURE_DETAIL,
  CLAIM_ORDER,
  CLAIM_STOCK,
  CLEAR_CART,
  SETTLE_DELIVERY,
  COURIER_BASE_FEE,
  COURIER_RATE,
  CREATE_ORDER,
  CREATE_ORDER_ITEM,
  CREATE_PAYMENT,
  GET_ASSIGNED_ORDER,
  GET_ITEMS_FOR_ORDERS,
  GET_ORDER_BY_USER,
  GET_ORDER_ITEMS,
  GET_ORDER_STATUS,
  LIST_DELIVERIES_FOR_COURIER,
  LIST_OPEN_ORDERS,
  LIST_ORDERS_BY_USER,
  ORDER_TOTALS,
  RECORD_DELIVERY_COST,
  USER_PROFILE_ADDRESS,
};
