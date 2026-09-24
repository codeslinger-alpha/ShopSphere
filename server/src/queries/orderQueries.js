// Placement reads the cart and claims stock; the reads below serve the customer's
// order history and a courier's run. Naming and joins follow cartQueries.js so the
// checkout page and the cart page describe a listing the same way.

// =========================================================
// Money policies
// =========================================================
// The schema has columns for platform revenue (orders.platform_commission,
// order_items.platform_commission) and for courier pay (delivery_personnel.earnings)
// but no rule anywhere that fills them, so they have sat at zero. These three
// numbers are that rule, and they live here rather than inline in a SQL string
// because a SQL string cannot be imported by anything that wants to explain the
// figure on screen.
//
// Changing a rate changes only future rows: every past order keeps the commission
// it was placed with, which is the reason the value is stored per line instead of
// recomputed at read time.

// What the platform keeps on a sale, as a fraction of the line subtotal.
const PLATFORM_COMMISSION_RATE = 0.05;

// What a courier is paid for one delivery: a flat fee for turning up, plus a
// share of the order. The flat part is what makes a short delivery worth doing;
// the share is what makes a large one worth doing carefully.
const COURIER_BASE_FEE = 3;
const COURIER_RATE = 0.02;

// =========================================================
// Placement — every statement here runs inside one
// transaction, so a failure anywhere leaves no trace.
// =========================================================

// ORDER BY prod_id is not cosmetic: the claim loop below runs in this order, and a
// fixed order is what stops two concurrent multi-item orders from each holding a
// row the other needs. Every request walks the same sequence, so one simply waits.
const CART_FOR_ORDER = `
    SELECT c.prod_id, c.quantity, p.name, p.unit_price, p.in_stock,
           s.name AS shop_name
    FROM cart_items c
    JOIN products p ON p.prod_id = c.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE c.user_id = $1
    ORDER BY c.prod_id
`;

// The concurrency guard, in one statement. The predicate and the decrement are
// evaluated by PostgreSQL while it holds the row lock, so a second buyer's claim
// waits and then re-tests against the stock the first one left. `in_stock >= $2`
// is therefore never a stale read, and rowCount 0 means "someone else got there
// first". The availability guards mirror ADD_CART_ITEM, so a listing that went
// off sale mid-checkout fails here rather than being sold. CHECK (in_stock >= 0)
// on the column is the backstop if this predicate is ever weakened.
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

// Fewest open orders first, so the work spreads. earnings and the id break ties
// so two checkouts in the same instant agree on who is next. NULL when nobody is
// available: the order sits unassigned, which the schema already allows and the
// seeded pending order already demonstrates.
const FIND_AVAILABLE_COURIER = `
    SELECT d.delivery_person_id
    FROM delivery_personnel d
    LEFT JOIN orders o ON o.delivery_person_id = d.delivery_person_id
         AND o.order_status IN ('pending', 'shipped')
    WHERE d.active_status = 'available'
    GROUP BY d.delivery_person_id
    ORDER BY COUNT(o.order_id), d.delivery_person_id
    LIMIT 1
`;

// total_amount is deliberately absent: trg_order_items_recalc_total owns it, and
// writing it here would be overwritten (or, worse, read as authoritative).
// delivery_person_id comes back so the confirmation can say whether a courier has
// been assigned yet, and shipping_address so the client sees which address the
// order actually carries rather than assuming the profile's.
const CREATE_ORDER = `
    INSERT INTO orders (user_id, shipping_address, delivery_person_id)
    VALUES ($1, $2, $3)
    RETURNING order_id, order_status, delivery_person_id, shipping_address,
              delivery_cost, created_at
`;

// The price is the cart's snapshot, passed as a value rather than re-read here, so
// a price change between the cart page and checkout cannot rewrite what the
// customer agreed to pay. The seed takes its snapshots the same way.
//
// The commission rate is a parameter rather than a literal so the number lives in
// one place (PLATFORM_COMMISSION_RATE below) instead of inside a SQL string that
// nothing can import.
//
// The casts on the multiplication are required, not stylistic. $3 through $5 are
// untyped parameters, and PostgreSQL refuses to guess: three of them multiplied
// together with nothing to anchor the type is 42725 ("operator is not unique:
// unknown * unknown"). Casting $3 straight to numeric is 42P08 instead — the
// VALUES list has already deduced it from the integer column it lands in, and a
// parameter cannot be two types at once. So $3 is cast to the type its column
// gave it and then widened, which anchors the arithmetic without contradicting
// the insert.
const CREATE_ORDER_ITEM = `
    INSERT INTO order_items (order_id, prod_id, quantity, unit_price, platform_commission)
    VALUES ($1, $2, $3, $4, ROUND($3::int::numeric * $4::numeric * $5::numeric, 2))
`;

// What the platform keeps on an order. Deliberately a separate column from
// total_amount, which fn_recalc_order_total owns: gross value and platform
// revenue are different numbers and confusing them would be a reporting bug
// nobody notices until the figures are needed.
//
// Summed from the lines rather than recomputed from the total, so a per-line
// rounding difference cannot make the order disagree with its own items.
const RECORD_PLATFORM_COMMISSION = `
    UPDATE orders o
    SET platform_commission = (
      SELECT COALESCE(SUM(oi.platform_commission), 0)
      FROM order_items oi WHERE oi.order_id = o.order_id
    )
    WHERE o.order_id = $1
    RETURNING platform_commission
`;

// The trigger has run by now, so this is the authoritative total.
const ORDER_TOTALS = `
    SELECT total_amount, delivery_cost FROM orders WHERE order_id = $1
`;

// paid_at is set explicitly to NULL. The column defaults to CURRENT_TIMESTAMP,
// which would date a cash-on-delivery payment as paid the moment it was created —
// the opposite of what 'pending' means.
const CREATE_PAYMENT = `
    INSERT INTO payments (order_id, amount, payment_method, payment_status, paid_at)
    VALUES ($1, $2, 'cash_on_delivery', 'pending', NULL)
    RETURNING transaction_id, amount, payment_method, payment_status, paid_at
`;

const CLEAR_CART = "DELETE FROM cart_items WHERE user_id = $1";

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

// Spelled out rather than reusing ORDER_SUMMARY_JOINS: the customer is an inner
// join here, and it reads better beside the orders table it attaches to than
// appended after a run of LEFT JOINs.
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

// The expected current status is part of the predicate: this is a compare-and-set,
// so a courier tapping "delivered" twice changes one row, not two, and a stale
// button press is rejected instead of silently re-applying.
//
// $3 is cast and the literal is typed because it is used twice with two different
// jobs: assigned to a varchar column, and compared against 'delivered'. Left bare,
// PostgreSQL infers a type from each use, cannot reconcile them, and refuses the
// statement outright with 42P08.
const ADVANCE_ORDER_STATUS = `
    UPDATE orders
    SET order_status = $3::varchar,
        delivered_at = CASE WHEN $3::varchar = 'delivered'::varchar
                            THEN CURRENT_TIMESTAMP
                            ELSE delivered_at END
    WHERE order_id = $1 AND delivery_person_id = $2 AND order_status = $4
    RETURNING order_id, order_status, delivered_at, total_amount, delivery_person_id
`;

const COMPLETE_PAYMENT = `
    UPDATE payments SET payment_status = 'completed', paid_at = $2
    WHERE order_id = $1 AND payment_status = 'pending'
    RETURNING transaction_id, payment_status, paid_at
`;

// What a courier is paid for one delivery, computed here so the formula and the
// write are the same statement: $2 = COURIER_BASE_FEE, $3 = COURIER_RATE,
// $4 = the order's total_amount. The casts are not decorative — $2 through $4
// arrive as untyped parameters and are used only in arithmetic, so PostgreSQL has
// nothing to infer their type from.
//
// Credited inside the delivered transition rather than tracked separately,
// because that transition already happens exactly once: the compare-and-set in
// ADVANCE_ORDER_STATUS is what guarantees it, so the earnings credit cannot be
// applied twice any more than the delivery can.
const CREDIT_COURIER_EARNINGS = `
    UPDATE delivery_personnel
    SET earnings = COALESCE(earnings, 0) + ROUND($2::numeric + $3::numeric * $4::numeric, 2)
    WHERE delivery_person_id = $1
    RETURNING delivery_person_id, earnings
`;

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

// Read only after ADVANCE_ORDER_STATUS matches nothing, to tell "not yours" apart
// from "already moved on".
const GET_ASSIGNED_ORDER = `
    SELECT order_id, order_status FROM orders
    WHERE order_id = $1 AND delivery_person_id = $2
`;

module.exports = {
  ADVANCE_ORDER_STATUS,
  CANCEL_ORDER,
  CART_FOR_ORDER,
  CLAIM_FAILURE_DETAIL,
  CLAIM_STOCK,
  CLEAR_CART,
  COMPLETE_PAYMENT,
  COURIER_BASE_FEE,
  COURIER_RATE,
  CREATE_ORDER,
  CREATE_ORDER_ITEM,
  CREDIT_COURIER_EARNINGS,
  CREATE_PAYMENT,
  FIND_AVAILABLE_COURIER,
  GET_ASSIGNED_ORDER,
  GET_ITEMS_FOR_ORDERS,
  GET_ORDER_BY_USER,
  GET_ORDER_ITEMS,
  GET_ORDER_STATUS,
  LIST_DELIVERIES_FOR_COURIER,
  LIST_ORDERS_BY_USER,
  ORDER_TOTALS,
  PLATFORM_COMMISSION_RATE,
  RECORD_PLATFORM_COMMISSION,
  USER_PROFILE_ADDRESS,
};
