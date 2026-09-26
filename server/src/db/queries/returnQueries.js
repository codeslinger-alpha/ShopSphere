// Customer returns: the goods coming back, the vendor's decision, the courier's
// pickup and the restock.
//
// Two rules run through every query here.
//
// The first is scope. A return is visible to exactly three people — the customer
// who asked, the vendor whose shop sold the listing, and a courier collecting it
// — and each of those is a predicate on the caller's own id rather than a filter
// applied afterwards. Nobody can ask for another party's returns because there is
// no parameter in which to ask.
//
// The second is that every state change is a compare-and-set. The status the
// transition starts from is part of the UPDATE predicate rather than read first
// and checked after, so two vendors clicking "approve" at the same moment cannot
// both debit the shop, and a courier tapping "collected" twice cannot restock
// twice. rowCount 0 is how the controller learns that somebody else got there
// first; it reports that as a 409, the same shape SHIP_ORDER and CANCEL_ORDER use.

// The columns every list returns, so the three surfaces describe a return the
// same way and a field cannot go missing from one of them.
const RETURN_COLUMNS = `
    r.return_id, r.order_id, r.prod_id, r.user_id, r.shop_id,
    r.quantity, r.reason, r.status, r.refund_amount::numeric(12,2) AS refund_amount,
    r.decision_note, r.decided_at, r.collected_at, r.restocked_at, r.created_at,
    p.name AS listing_name, s.name AS shop_name,
    u.name AS customer_name,
    d.name AS collected_by_name
`;

const RETURN_JOINS = `
    FROM product_returns r
    JOIN products p ON p.prod_id = r.prod_id
    JOIN shops s ON s.shop_id = r.shop_id
    JOIN users u ON u.user_id = r.user_id
    LEFT JOIN users d ON d.user_id = r.collected_by
`;

// =========================================================
// Reads
// =========================================================

// A customer's own returns, newest first. The order line's own price is not
// re-read: refund_amount was frozen when the request was made.
const LIST_RETURNS_FOR_CUSTOMER = `
    SELECT ${RETURN_COLUMNS}
    ${RETURN_JOINS}
    WHERE r.user_id = $1
    ORDER BY r.return_id DESC
`;

// What a vendor has to decide on and what they have already decided. The shop is
// the vendor's own, by ownership rather than by a shop id the caller supplied.
const LIST_RETURNS_FOR_VENDOR = `
    SELECT ${RETURN_COLUMNS}
    ${RETURN_JOINS}
    WHERE s.owner = $1
    ORDER BY r.return_id DESC
`;

// The pickup list: approved and not yet collected, which is the courier's work.
// Deliberately not restricted to the courier who delivered the order — see the
// note on product_returns.collected_by in the schema.
//
// The caller's own id is in the join rather than the WHERE clause so that the
// statement has the parameter the controller binds, and it means exactly what
// COLLECT_RETURN means: an active account may collect. A courier whose account
// has been disabled sees no pickups, because none of them would be theirs to do.
const LIST_RETURNS_FOR_COURIER = `
    SELECT ${RETURN_COLUMNS},
           l.street_address, l.city, l.state_province, l.postal_code,
           cu.phone_numbers AS customer_phone
    FROM product_returns r
    JOIN products p ON p.prod_id = r.prod_id
    JOIN shops s ON s.shop_id = r.shop_id
    JOIN users u ON u.user_id = r.user_id
    LEFT JOIN users d ON d.user_id = r.collected_by
    JOIN orders o ON o.order_id = r.order_id
    JOIN locations l ON l.location_id = o.shipping_address
    JOIN users cu ON cu.user_id = r.user_id
    JOIN users me ON me.user_id = $1 AND me.active_status = 'active'
    WHERE r.status = 'approved'
    ORDER BY r.return_id
`;

// One return, for the sentence a refusal gets. Scoped to the customer so it
// cannot be used to read somebody else's return by guessing an id.
const GET_CUSTOMER_RETURN = `
    SELECT ${RETURN_COLUMNS}
    ${RETURN_JOINS}
    WHERE r.return_id = $1 AND r.user_id = $2
`;

// The order line a request is about, and whether it is the customer's to return.
// The delivered test is repeated in fn_check_return_quantity, which is the
// enforcement; this read exists only to say why.
const RETURNABLE_LINE = `
    SELECT oi.quantity AS ordered, oi.unit_price, o.order_status,
           p.name AS listing_name, p.shop_id, s.name AS shop_name
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    JOIN products p ON p.prod_id = oi.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    WHERE oi.order_id = $1 AND oi.prod_id = $2 AND o.user_id = $3
`;

// =========================================================
// Writes
// =========================================================

// refund_amount is computed in the database from the order line's stored price
// rather than sent by the caller: the customer's own figure for what they are
// owed is not evidence of anything.
//
// Quantity is cast once, explicitly, because the same parameter is both the
// value written to an INT column and an operand of a numeric multiplication.
// Left bare, PostgreSQL deduces integer from the column and numeric from the
// arithmetic and refuses the statement as inconsistent (42P08).
const CREATE_RETURN = `
    INSERT INTO product_returns (order_id, prod_id, user_id, shop_id, quantity, reason, refund_amount)
    SELECT oi.order_id, oi.prod_id, o.user_id, p.shop_id, $4::int, $5,
           ROUND($4::int * oi.unit_price, 2)
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    JOIN products p ON p.prod_id = oi.prod_id
    WHERE oi.order_id = $1 AND oi.prod_id = $2 AND o.user_id = $3
    RETURNING return_id, order_id, prod_id, status, refund_amount
`;

// Approving accepts the obligation, so this is the transition that debits the
// shop and writes the refund and therefore the one that must happen exactly once.
// Ownership of the shop is in the predicate, so a vendor cannot decide another
// shop's return even by guessing a return id.
const APPROVE_RETURN = `
    UPDATE product_returns r
    SET status = 'approved', decision_note = $3, decided_at = CURRENT_TIMESTAMP
    FROM shops s
    WHERE r.return_id = $1 AND s.shop_id = r.shop_id AND s.owner = $2
      AND r.status = 'requested'
    RETURNING r.return_id, r.order_id, r.prod_id, r.user_id, r.shop_id,
              r.quantity, r.refund_amount
`;

// A rejection is the other decision, and it moves no money and no stock: the
// customer keeps the goods and is owed nothing. It exists so the vendor has an
// answer that is not silence, and so the customer can ask again.
const REJECT_RETURN = `
    UPDATE product_returns r
    SET status = 'rejected', decision_note = $3, decided_at = CURRENT_TIMESTAMP
    FROM shops s
    WHERE r.return_id = $1 AND s.shop_id = r.shop_id AND s.owner = $2
      AND r.status = 'requested'
    RETURNING r.return_id, r.status
`;

// Any active courier may collect. "Active" is the courier's own account being
// enabled, not their availability flag: a courier who is on another delivery is
// still allowed to pick this up, and refusing them would only stall the return.
const COLLECT_RETURN = `
    UPDATE product_returns r
    SET status = 'collected', collected_by = $2, collected_at = CURRENT_TIMESTAMP
    FROM users u
    WHERE r.return_id = $1 AND u.user_id = $2 AND u.active_status = 'active'
      AND r.status = 'approved'
    RETURNING r.return_id, r.status, r.quantity, r.prod_id, r.shop_id
`;

// The goods are back on the shelf. Guarded on 'collected' so a return cannot be
// restocked twice, and on shop ownership so only the shop that sold it can
// relist it. The in_stock increment is a separate statement in the same
// transaction, because these are two tables and the guard is the return's own.
const MARK_RESTOCKED = `
    UPDATE product_returns r
    SET status = 'restocked', restocked_at = CURRENT_TIMESTAMP
    FROM shops s
    WHERE r.return_id = $1 AND s.shop_id = r.shop_id AND s.owner = $2
      AND r.status = 'collected'
    RETURNING r.return_id, r.status, r.quantity, r.prod_id
`;

const RESTOCK_PRODUCT = `
    UPDATE products SET in_stock = in_stock + $2
    WHERE prod_id = $1
    RETURNING prod_id, in_stock
`;

// A shop is charged for a return it approved whatever its balance is. This is
// deliberately not the same query as the wholesale purchase debit, which refuses
// when the money is not there: a vendor must not be able to escape a customer's
// refunded money by having spent it, so this one is allowed to take the balance
// negative. The two are separate constants so that difference is legible.
const CHARGE_SHOP_BALANCE = `
    UPDATE shops SET balance = balance - $2
    WHERE shop_id = $1
    RETURNING shop_id, balance
`;

const CREATE_CUSTOMER_REFUND = `
    INSERT INTO customer_refunds (return_id, order_id, user_id, shop_id, amount)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING refund_id, return_id, amount, created_at
`;

module.exports = {
  APPROVE_RETURN,
  CHARGE_SHOP_BALANCE,
  COLLECT_RETURN,
  CREATE_CUSTOMER_REFUND,
  CREATE_RETURN,
  GET_CUSTOMER_RETURN,
  LIST_RETURNS_FOR_COURIER,
  LIST_RETURNS_FOR_CUSTOMER,
  LIST_RETURNS_FOR_VENDOR,
  MARK_RESTOCKED,
  REJECT_RETURN,
  RESTOCK_PRODUCT,
  RETURNABLE_LINE,
};
