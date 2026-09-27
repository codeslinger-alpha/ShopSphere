// A vendor's own shops, stock and money.
//
// Every statement here is scoped by `s.owner = :1` rather than by a shop id the
// caller supplied, so a vendor's reach cannot be widened by guessing a number.
// The one exception is the reads that follow an ownership check made earlier in
// the same request, and each of those repeats the ownership test in its own
// predicate rather than trusting the check to have happened.
//
// Three things are spelled the way Oracle spells them rather than the way
// PostgreSQL did. NULL needs a type of its own in a UNION ALL, or the branches
// disagree about what the column is. An expression that produces money is
// TO_CHARed to two places, because the adapter formats a declared NUMBER(12,2)
// column but has nothing to go by for a computed one and the API has always
// shown two. And `discontinued = false` is `discontinued = 0`, the column being
// NUMBER(1) — src/db/execute.js turns a boolean bind into that 0 or 1, so a
// caller may still pass one.

const MONEY = "'FM9999999990.00'";
const asMoney = (expression) => `TO_CHAR(${expression}, ${MONEY})`;
// A branch of a UNION ALL that has no quantity of its own still has to say what
// kind of nothing it is, or Oracle takes the bare NULL for a string and refuses
// to line it up with the NUMBER the other branches produce.
const NO_QUANTITY = "CAST(NULL AS NUMBER(10))";

const LIST_OWNED_SHOPS = `
  SELECT
    s.*,
    l.street_address,
    l.city,
    l.postal_code,
    l.state_province,
    l.country_id
  FROM shops s
  LEFT JOIN locations l ON l.location_id = s.address
  WHERE s.owner = :1
  ORDER BY s.shop_id
`;

const OWNED_SHOP = `
  SELECT shop_id
  FROM shops
  WHERE shop_id = :1 AND owner = :2
`;
// One shop's balance, for the recharge page. No cast: the column is declared
// NUMBER(12,2), which is the rule the adapter formats a money column by.
const SHOP_BALANCE = `
  SELECT shop_id, name, balance
  FROM shops
  WHERE shop_id = :1
`;
// active_status is deliberately absent: shop status is an administrator-only
// field. A vendor must not be able to approve their own shop, nor to undo a ban.
const UPDATE_SHOP = `
  UPDATE shops
  SET name = :1, description = :2, phone_numbers = :3, logo = :4,
      cover_photo = :5, address = :6
  WHERE shop_id = :7 AND owner = :8
  RETURNING *
`;
// A new shop waits for an administrator. It is invisible to the storefront
// because every catalog query requires active_status = 'active'.
const CREATE_SHOP = `
  INSERT INTO shops (
    name, description, phone_numbers, logo, cover_photo, address, active_status, owner
  ) VALUES (:1, :2, :3, :4, :5, :6, 'pending', :7)
  RETURNING *
`;

const LIST_OWNED_LISTINGS = `
  SELECT p.*, s.name AS shop_name, mp.manufacturer, c.name AS category_name
  FROM products p
  JOIN shops s ON s.shop_id = p.shop_id
  JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
  JOIN categories c ON c.category_id = mp.category_id
  WHERE s.owner = :1
  ORDER BY p.prod_id
`;
const LIST_OWNED_PURCHASES = `
  SELECT
    sp.*,
    mp.name,
    s.name AS shop_name,
    ${asMoney("sp.quantity * sp.wholesale_unit_price")} AS total
  FROM shop_purchases sp
  JOIN shops s ON s.shop_id = sp.shop_id
  JOIN master_products mp ON mp.master_prod_id = sp.master_prod_id
  WHERE s.owner = :1
  ORDER BY sp.purchase_id DESC
`;

const ACTIVE_OWNED_SHOP = `
  SELECT shop_id
  FROM shops
  WHERE shop_id = :1 AND owner = :2 AND active_status = 'active'
`;
const AVAILABLE_MASTER = `
  SELECT *
  FROM master_products
  WHERE master_prod_id = :1 AND active_status = 'available'
`;
// One listing per (shop, master) is what the purchase path maintains, so the
// oldest is the one to restock. FETCH FIRST is Oracle's LIMIT, and it is the
// standard spelling the two agree on.
const LISTING_FOR_MASTER = `
  SELECT prod_id, in_stock
  FROM products
  WHERE shop_id = :1 AND master_prod_id = :2
  ORDER BY prod_id
  FETCH FIRST 1 ROWS ONLY
`;
const CREATE_PURCHASE = `
  INSERT INTO shop_purchases (
    shop_id, master_prod_id, quantity, wholesale_unit_price
  ) VALUES (:1, :2, :3, :4)
`;

// Buying stock costs money, and this is where it leaves the balance. The funds
// test is part of the predicate rather than a read followed by a check, so two
// purchases racing cannot both pass it and overdraw the shop: the second waits
// on the row lock, then re-tests against the committed balance. rowCount 0 means
// the balance could not cover it, which the controller reports as a 409.
//
// Ownership is repeated here so the predicate is self-contained; the caller has
// already checked it, and a query that only subtracts for the right owner is
// cheaper to trust than one that relies on a check made elsewhere.
const DEBIT_SHOP_BALANCE = `
  UPDATE shops
  SET balance = balance - :2
  WHERE shop_id = :1 AND owner = :3 AND balance >= :2
  RETURNING shop_id, balance
`;

// A recharge credits the balance and writes its ledger row. No gateway is
// involved, so these two are the whole of it.
const CREDIT_SHOP_BALANCE = `
  UPDATE shops
  SET balance = balance + :2
  WHERE shop_id = :1 AND owner = :3
  RETURNING shop_id, balance
`;
const CREATE_TOPUP = `
  INSERT INTO shop_topups (shop_id, amount, method)
  VALUES (:1, :2, :3)
  RETURNING topup_id, shop_id, amount, method, created_at
`;
// The recharge page's statement of movements, newest first. Both ledgers are
// read in one round trip and told apart by `kind`, which is what lets the page
// show a single list rather than two that have to be interleaved by hand.
//
// Every branch produces a two-place string for its amount. In PostgreSQL each
// branch cast to numeric(12,2) and the cast made the columns line up as one
// type; Oracle lines them up just as well as strings, and a string is what the
// page has always been handed.
const LIST_SHOP_MOVEMENTS = `
  SELECT 'sale' AS kind, o.order_id AS reference, ${NO_QUANTITY} AS quantity,
         ${asMoney("SUM(oi.quantity * oi.unit_price)")} AS amount,
         o.delivered_at AS created_at
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.prod_id = oi.prod_id
  WHERE p.shop_id = :1 AND o.order_status = 'delivered'
  GROUP BY o.order_id, o.delivered_at
  UNION ALL
  SELECT 'purchase', sp.purchase_id, sp.quantity,
         ${asMoney("-(sp.quantity * sp.wholesale_unit_price)")}, sp.purchased_at
  FROM shop_purchases sp WHERE sp.shop_id = :1
  UNION ALL
  SELECT 'topup', t.topup_id, ${NO_QUANTITY},
         ${asMoney("t.amount")}, t.created_at
  FROM shop_topups t WHERE t.shop_id = :1
  UNION ALL
  SELECT 'admin_refund', vr.refund_id, vr.units,
         ${asMoney("vr.amount")}, vr.created_at
  FROM vendor_refunds vr WHERE vr.shop_id = :1
  UNION ALL
  -- The other direction of money: this is the shop paying a customer back, not
  -- the platform paying the shop. Same shape, opposite sign.
  SELECT 'customer_return', cr.return_id, r.quantity,
         ${asMoney("-cr.amount")}, cr.created_at
  FROM customer_refunds cr
  JOIN product_returns r ON r.return_id = cr.return_id
  WHERE cr.shop_id = :1
  ORDER BY created_at DESC, kind
`;
const RESTOCK_LISTING = `
  UPDATE products
  SET in_stock = in_stock + :1, unit_price = :2, description = :3,
      discontinued = 0, name = :4, images = :5
  WHERE prod_id = :6
  RETURNING *
`;
const CREATE_LISTING = `
  INSERT INTO products (
    name, images, master_prod_id, description, shop_id, in_stock, unit_price
  ) VALUES (:1, :2, :3, :4, :5, :6, :7)
  RETURNING *
`;
// Ownership is an EXISTS subquery rather than PostgreSQL's `UPDATE ... FROM
// shops`, which Oracle has no form of. It is the same join written where Oracle
// can read it, and it keeps the test inside the write, so a listing cannot
// change hands between a check and the update that follows it. The listing is
// named by its table because Oracle's SET clause takes a bare column name, and
// the correlation to it goes through that name.
const UPDATE_OWNED_LISTING = `
  UPDATE products
  SET description = :1, unit_price = :2, discontinued = :3
  WHERE prod_id = :5
    AND EXISTS (
      SELECT 1 FROM shops s
      WHERE s.shop_id = products.shop_id AND s.owner = :4
    )
  RETURNING *
`;
module.exports = {
  ACTIVE_OWNED_SHOP,
  AVAILABLE_MASTER,
  CREATE_LISTING,
  CREATE_PURCHASE,
  CREATE_SHOP,
  CREATE_TOPUP,
  CREDIT_SHOP_BALANCE,
  DEBIT_SHOP_BALANCE,
  LIST_OWNED_LISTINGS,
  LIST_OWNED_PURCHASES,
  LIST_OWNED_SHOPS,
  LIST_SHOP_MOVEMENTS,
  LISTING_FOR_MASTER,
  OWNED_SHOP,
  RESTOCK_LISTING,
  SHOP_BALANCE,
  UPDATE_OWNED_LISTING,
  UPDATE_SHOP,
};
