const oracledb = require("oracledb");

// The courier's pay, and therefore the delivery charge the customer pays: the
// two are the same number now. A flat part makes a short delivery worth doing,
// the share makes a large one worth doing carefully. Applied at placement and
// stored on the order, so changing these changes future orders only.
const COURIER_BASE_FEE = 3;
const COURIER_RATE = 0.02;

// What every computed money column in this file is wrapped in.
//
// PostgreSQL said `::numeric(12,2)` and node-pg handed back the string "25.00".
// Oracle arithmetic produces a NUMBER whose declared scale depends on which
// operators were used, which is not something a caller should have to know, so
// the formatting is stated rather than inferred. Ten digits is the whole of a
// NUMBER(12,2): two of the twelve are the decimals.
const asMoney = (expression) => `TO_CHAR(${expression}, 'FM9999999990.00')`;

// Lock the cart rows so concurrent checkouts cannot buy the same cart twice.
// Stable product order also gives stock claims a consistent lock order.
//
// Oracle takes a column rather than a table alias in FOR UPDATE OF, which is
// why this names c.prod_id: the cart row is what is being locked, and the
// listings it points at are read only.
const CART_PRODUCT_IDS = "SELECT prod_id FROM cart_items WHERE user_id = :1 ORDER BY prod_id";
const CART_FOR_ORDER = `
    SELECT c.prod_id, c.quantity, p.name, p.unit_price, p.in_stock,
           s.name AS shop_name
    FROM cart_items c
    JOIN products p ON p.prod_id = c.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE c.user_id = :1
      AND c.prod_id IN (:2)
    ORDER BY c.prod_id
    FOR UPDATE OF c.prod_id
`;

// Predicate and stock decrement execute under one row lock; no read/write gap.
//
// PostgreSQL joined the two tables in an UPDATE ... FROM; Oracle has no such
// form, so each becomes an EXISTS in the predicate — the same test, and still
// one statement, which is the property that matters here.
//
// The listing is named by its table rather than by an alias, because Oracle's
// SET clause takes a bare column name: `SET p.in_stock` is not something it
// will parse. The subqueries correlate to `products` by name instead.
const CLAIM_STOCK = `
    UPDATE products SET in_stock = in_stock - :2
    WHERE prod_id = :1
      AND discontinued = 0
      AND in_stock >= :2
      AND EXISTS (
        SELECT 1 FROM shops s
        WHERE s.shop_id = products.shop_id AND s.active_status = 'active')
      AND EXISTS (
        SELECT 1 FROM master_products mp
        WHERE mp.master_prod_id = products.master_prod_id
          AND mp.active_status = 'available')
    RETURNING prod_id, in_stock
`;

// Read only after a claim fails, to say what is actually left. Oracle's READ
// COMMITTED means this sees the committed result of whoever won the row.
const CLAIM_FAILURE_DETAIL = `
    SELECT p.name, p.in_stock, p.discontinued,
           s.name AS shop_name, s.active_status AS shop_status,
           mp.active_status AS master_status
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.prod_id = :1
`;

// The order-item trigger owns total_amount. An order is placed with no courier:
// who carries it is decided afterwards, on the open board below.
//
// This used to pick a courier here, by joining delivery_personnel and taking the
// active, available one with the fewest open orders. That answer was final —
// nothing in the server ever revisited it — so a checkout that happened to find
// nobody left the order assigned to NULL, where the courier list's
// `delivery_person_id = :1` made it invisible to every courier, for good. An
// order waiting on a board that everyone can see is the better failure.
const CREATE_ORDER = `
    INSERT INTO orders (user_id, shipping_address, delivery_person_id)
    VALUES (:1, :2, NULL)
    RETURNING order_id, order_status, delivery_person_id, shipping_address,
              delivery_cost, created_at
`;

// Freeze the price read during checkout, not the price from an earlier cart page.
const CREATE_ORDER_ITEM = `
    INSERT INTO order_items (order_id, prod_id, quantity, unit_price)
    VALUES (:1, :2, :3, :4)
`;

// Prices the trip and stores it on the order, which is what makes the courier's
// pay and the customer's delivery charge one number. This runs after the items
// because it is a share of total_amount, and total_amount is still 0 until
// trg_order_items_recalc_total has fired.
const RECORD_DELIVERY_COST = `
    UPDATE orders
    SET delivery_cost = ROUND(:2 + :3 * total_amount, 2)
    WHERE order_id = :1
    RETURNING delivery_cost
`;

// The trigger has run by now, so this is the authoritative total. The function's
// result is a bare NUMBER — a PL/SQL return type carries no scale for the
// adapter to format by — so it is formatted here instead. delivery_cost is a
// column and needs no help.
const ORDER_TOTALS = `
    SELECT ${asMoney("fn_order_subtotal(order_id)")} AS total_amount, delivery_cost
    FROM orders WHERE order_id = :1
`;

// paid_at is set explicitly to NULL. The column defaults to LOCALTIMESTAMP,
// which would date a cash-on-delivery payment as paid the moment it was created
// — the opposite of what 'pending' means.
const CREATE_PAYMENT = `
    INSERT INTO payments (order_id, amount, payment_method, payment_status, paid_at)
    SELECT order_id, total_amount + delivery_cost, 'cash_on_delivery', 'pending', NULL
    FROM orders WHERE order_id = :1
    RETURNING transaction_id, amount, payment_method, payment_status, paid_at
`;

// Preserve products added after the checkout snapshot was read.
const CLEAR_CART = "DELETE FROM cart_items WHERE user_id = :1 AND prod_id IN (:2)";

// Where a checkout falls back to when the customer does not enter an address.
const USER_PROFILE_ADDRESS = "SELECT address FROM users WHERE user_id = :1";

// =========================================================
// Shared projections
// =========================================================

// The order's own row, its address, its courier and its payment, each of which
// is one row per order, so they are joined. The items are the only thing that
// multiplies, and they are counted in subqueries instead.
//
// PostgreSQL could group by the primary keys and let the other columns of those
// tables come along, on the grounds that they are functionally dependent on the
// key. Oracle will not accept that argument, and grouping by every selected
// column instead would be a longer way of writing "one row per order" — which
// is what a scalar subquery says directly.
const ORDER_SUMMARY_COLUMNS = `
    o.order_id, o.order_status, o.total_amount, o.delivery_cost,
    o.created_at, o.delivered_at, o.shipping_address,
    l.street_address, l.city, l.state_province, l.postal_code,
    pay.transaction_id, pay.payment_status, pay.payment_method,
    pay.amount AS payment_amount, pay.paid_at,
    d.name AS delivery_person_name, d.phone_numbers AS delivery_person_phone,
    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.order_id)
        AS item_count,
    (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
     WHERE oi.order_id = o.order_id) AS item_quantity
`;
const ORDER_SUMMARY_JOINS = `
    FROM orders o
    JOIN locations l ON l.location_id = o.shipping_address
    LEFT JOIN payments pay ON pay.order_id = o.order_id
    LEFT JOIN users d ON d.user_id = o.delivery_person_id
`;

const LIST_ORDERS_BY_USER = `
    SELECT ${ORDER_SUMMARY_COLUMNS}
    ${ORDER_SUMMARY_JOINS}
    WHERE o.user_id = :1
    ORDER BY o.created_at DESC, o.order_id DESC
`;

const GET_ORDER_BY_USER = `
    SELECT ${ORDER_SUMMARY_COLUMNS}
    ${ORDER_SUMMARY_JOINS}
    WHERE o.order_id = :1 AND o.user_id = :2
`;

// subtotal is formatted rather than returned raw: the client has always had it
// as a two-decimal string, and a product of two NUMBERs has no declared scale
// to fall back on.
const GET_ORDER_ITEMS = `
    SELECT oi.prod_id, oi.quantity, oi.unit_price,
           ${asMoney("oi.quantity * oi.unit_price")} AS subtotal,
           p.name, p.images, p.discontinued, p.shop_id,
           s.name AS shop_name
    FROM order_items oi
    JOIN products p ON p.prod_id = oi.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    WHERE oi.order_id = :1
    ORDER BY s.name, p.name
`;

// =========================================================
// Cancellation
// =========================================================

// Only a pending order can be cancelled, and fn_guard_order_transition enforces
// that in the database too. The status is part of the predicate rather than read
// first and checked after, so two cancels racing cannot both restore stock:
// trg_cleanup_cancelled_order fires only on the transition that actually happens.
const CANCEL_ORDER = `
    UPDATE orders SET order_status = 'cancelled'
    WHERE order_id = :1 AND user_id = :2 AND order_status = 'pending'
    RETURNING order_id, order_status
`;

const GET_ORDER_STATUS = `
    SELECT o.order_id, o.order_status
    FROM orders o WHERE o.order_id = :1 AND o.user_id = :2
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
    WHERE o.delivery_person_id = :1 AND o.order_status IN ('pending', 'shipped')
    ORDER BY o.created_at, o.order_id
`;

// The open board: placed orders nobody has taken.
//
// Oldest first, so the order that has waited longest is at the top. That is the
// only defence against cherry-picking the system has — there is no distance to
// sort by and no dispatch to overrule a courier — so the ordering is deliberate
// rather than incidental.
//
// The customer's name and phone are not selected. A courier deciding whether to
// take a trip needs the address and what it pays; they do not need to know who
// lives there until they have taken it on, and the board is visible to every
// courier on duty, including the ones who never accept anything.
//
// The caller has to be an on-duty courier to see this at all, so an off-duty one
// gets an empty board rather than a screen of buttons that would each refuse.
const LIST_OPEN_ORDERS = `
    SELECT ${ORDER_SUMMARY_COLUMNS}
    FROM orders o
    JOIN locations l ON l.location_id = o.shipping_address
    LEFT JOIN payments pay ON pay.order_id = o.order_id
    LEFT JOIN users d ON d.user_id = o.delivery_person_id
    WHERE o.delivery_person_id IS NULL AND o.order_status = 'pending'
      AND EXISTS (
        SELECT 1 FROM delivery_personnel me
        JOIN users mu ON mu.user_id = me.delivery_person_id
        WHERE me.delivery_person_id = :1
          AND me.active_status = 'available'
          AND mu.active_status = 'active')
    ORDER BY o.created_at, o.order_id
`;

// Taking an order off the board.
//
// This is the whole of the concurrency story, so the two things that could go
// wrong are both in the predicate rather than read first and checked after.
// `delivery_person_id IS NULL` is what makes the claim exactly once: two
// couriers tapping Accept at the same moment cannot both match, because the
// second waits on the row lock and then re-tests the committed value, finds the
// order no longer unassigned, and matches nothing. rowCount = 0 becomes a 409.
//
// The caller's own availability is the other: an account that is disabled, or a
// courier who has taken themselves off duty, cannot claim new work. It is joined
// for the same reason COLLECT_RETURN joins the caller — so the rule is part of
// the statement rather than a separate read that could go stale between the two.
// PostgreSQL joined delivery_personnel and users into the UPDATE; Oracle has no
// such form, so the join becomes an EXISTS over what is now read-only, and the
// order is named by its table because SET will not take an alias.
const CLAIM_ORDER = `
    UPDATE orders SET delivery_person_id = :2
    WHERE order_id = :1
      AND delivery_person_id IS NULL AND order_status = 'pending'
      AND EXISTS (
        SELECT 1 FROM delivery_personnel d
        JOIN users u ON u.user_id = d.delivery_person_id
        WHERE d.delivery_person_id = :2
          AND d.active_status = 'available' AND u.active_status = 'active')
    RETURNING order_id, order_status, delivery_person_id
`;

// Shipping is a single guarded write; delivery uses the multi-table procedure.
const SHIP_ORDER = `
    UPDATE orders SET order_status = 'shipped'
    WHERE order_id = :1 AND delivery_person_id = :2 AND order_status = 'pending'
    RETURNING order_id, order_status, delivered_at, total_amount, delivery_person_id
`;

// A procedure cannot be called as a statement the way PostgreSQL's CALL could
// be, and its result cannot be read from the call — it comes back in an output
// bind, which the anonymous block names. So this is the one entry in the file
// that is a pair rather than a string: the block, and the binds it needs.
//
// The result is a CLOB of JSON. The caller parses it; a driver has no way to
// know that a CLOB is meant to be read as one.
const SETTLE_DELIVERY = {
  text: `BEGIN settle_delivery(:order_id, :courier_id, :result); END;`,
  binds: (orderId, courierId) => ({
    order_id: orderId,
    courier_id: courierId,
    result: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_CLOB },
  }),
};

// One round trip for every parcel on the run, rather than one per order.
const GET_ITEMS_FOR_ORDERS = `
    SELECT oi.order_id, oi.prod_id, oi.quantity,
           p.name, s.name AS shop_name
    FROM order_items oi
    JOIN products p ON p.prod_id = oi.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    WHERE oi.order_id IN (:1)
    ORDER BY s.name, p.name
`;

// Read only after SHIP_ORDER matches nothing, to tell "not yours" apart
// from "already moved on".
const GET_ASSIGNED_ORDER = `
    SELECT order_id, order_status FROM orders
    WHERE order_id = :1 AND delivery_person_id = :2
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
