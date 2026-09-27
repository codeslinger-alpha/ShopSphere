const asMoney = (expression) => `TO_CHAR(${expression}, 'FM9999999990.00')`;

// The catalog console's reads and writes. Two shapes of Oracle spelling run
// through the file:
//
//   * `JOIN ... USING (column)` is `JOIN ... ON a.column = b.column`. Oracle has
//     no USING clause.
//   * A boolean expression in a result set is CAST(CASE WHEN ... THEN 1 ELSE 0
//     END AS NUMBER(1)), which is the shape src/db/execute.js reads back into
//     true and false — the same agreement the schema's own NUMBER(1) columns
//     make. A money expression is TO_CHARed to two places for the same reason:
//     the adapter can format a declared NUMBER(12,2) column but has nothing to
//     go by for a computed one.

const MASTER_SELECT = `
  SELECT mp.*, c.name AS category_name
  FROM master_products mp
  JOIN categories c ON c.category_id = mp.category_id
`;

const LIST_MASTERS = `${MASTER_SELECT} ORDER BY mp.master_prod_id`;
const LIST_AVAILABLE_MASTERS = `
  ${MASTER_SELECT}
  WHERE mp.active_status = 'available'
  ORDER BY mp.name
`;
const LIST_MASTER_ATTRIBUTES = `
  SELECT
    av.master_prod_id,
    a.attribute_id,
    a.name,
    a.description,
    av.attrib_value,
    CAST(CASE WHEN ca.attribute_id IS NOT NULL THEN 1 ELSE 0 END AS NUMBER(1))
      AS required
  FROM attribute_values av
  JOIN master_products mp ON mp.master_prod_id = av.master_prod_id
  JOIN attributes a ON a.attribute_id = av.attribute_id
  LEFT JOIN category_attributes ca
    ON ca.category_id = mp.category_id
   AND ca.attribute_id = av.attribute_id
  ORDER BY av.master_prod_id, a.name
`;

const LIST_CATALOG_CATEGORIES = `SELECT * FROM categories ORDER BY name`;
const LIST_CATEGORY_ATTRIBUTES = `
  SELECT category_id, attribute_id
  FROM category_attributes
  ORDER BY category_id, attribute_id
`;
const LIST_ATTRIBUTES = `SELECT * FROM attributes ORDER BY name`;

const CREATE_ATTRIBUTE = `
  INSERT INTO attributes (name, description)
  VALUES (:1, :2)
  RETURNING *
`;
const CATEGORY_EXISTS = `SELECT 1 FROM categories WHERE category_id = :1`;
// Walk up from the category to its descendants. Oracle's recursive subquery
// factoring is declared with WITH, not WITH RECURSIVE, and its recursive member
// has to be UNION ALL rather than the UNION PostgreSQL wrote: the tree has one
// parent per node, so the two reach the same set, and saveCategory refuses to
// create a cycle before this is ever asked.
const CATEGORY_PARENT_CYCLE = `
  WITH descendants (category_id) AS (
    SELECT category_id FROM categories WHERE category_id = :1
    UNION ALL
    SELECT c.category_id
    FROM categories c
    JOIN descendants d ON c.parent_category = d.category_id
  )
  SELECT 1 FROM descendants WHERE category_id = :2
`;
const UPDATE_CATEGORY = `
  UPDATE categories
  SET name = :1, description = :2, parent_category = :3
  WHERE category_id = :4
  RETURNING *
`;
const CREATE_CATEGORY = `
  INSERT INTO categories (name, description, parent_category)
  VALUES (:1, :2, :3)
  RETURNING *
`;
const DELETE_CATEGORY_ATTRIBUTES = `
  DELETE FROM category_attributes WHERE category_id = :1
`;
const CREATE_CATEGORY_ATTRIBUTE = `
  INSERT INTO category_attributes (category_id, attribute_id)
  VALUES (:1, :2)
`;
// Give every existing master of the category a starting value for the attribute
// it has just been told is required. `ON CONFLICT ... DO NOTHING` is Oracle's
// missing NOT EXISTS: a master that already has a value keeps it.
const BACKFILL_CATEGORY_ATTRIBUTE = `
  INSERT INTO attribute_values (master_prod_id, attribute_id, attrib_value)
  SELECT mp.master_prod_id, :2, :3
  FROM master_products mp
  WHERE mp.category_id = :1
    AND NOT EXISTS (
      SELECT 1 FROM attribute_values av
      WHERE av.master_prod_id = mp.master_prod_id AND av.attribute_id = :2
    )
`;
const CATEGORY_HAS_DEPENDENTS = `
  SELECT 1 FROM categories WHERE parent_category = :1
  UNION ALL
  SELECT 1 FROM master_products WHERE category_id = :1
`;
const DELETE_CATEGORY = `
  DELETE FROM categories WHERE category_id = :1 RETURNING category_id
`;

const UPDATE_MASTER = `
  UPDATE master_products
  SET name = :1, manufacturer = :2, images = :3, description = :4,
      category_id = :5, wholesale_price = :6, active_status = :7
  WHERE master_prod_id = :8
  RETURNING *
`;
const CREATE_MASTER = `
  INSERT INTO master_products (
    name, manufacturer, images, description, category_id, wholesale_price, active_status
  ) VALUES (:1, :2, :3, :4, :5, :6, :7)
  RETURNING *
`;
const DELETE_MASTER_VALUES = `
  DELETE FROM attribute_values WHERE master_prod_id = :1
`;
const CREATE_MASTER_VALUE = `
  INSERT INTO attribute_values (master_prod_id, attribute_id, attrib_value)
  VALUES (:1, :2, :3)
`;
const SYNC_MASTER_LISTINGS = `
  UPDATE products SET name = :1, images = :2 WHERE master_prod_id = :3
`;
const DISCONTINUE_MASTER = `
  UPDATE master_products
  SET active_status = 'discontinued'
  WHERE master_prod_id = :1
  RETURNING master_prod_id
`;

// =========================================================
// The rule PostgreSQL deferred to the commit
//
// A master product may only be 'available' once every attribute its category
// requires has a value. PostgreSQL enforced it with a constraint trigger declared
// DEFERRABLE INITIALLY DEFERRED, because the API writes the master and then its
// values, and an immediate check would refuse the first write of a perfectly good
// pair. Oracle defers constraints, not triggers, and this is not a constraint, so
// the check lives where the commit does: adminCatalogController runs it as the
// last statement of saveMaster and saveCategory, on the rows those two writes
// could have made incomplete. A direct SQL writer can still record an incomplete
// master; nothing in the API can.
// =========================================================
const INCOMPLETE_MASTER = `
  SELECT master_prod_id, name, attribute_name
  FROM incomplete_masters
  WHERE master_prod_id = :1
`;

// Changing a category's required attributes can strand the masters already in
// it, so the category path asks the same question about each of them.
const INCOMPLETE_CATEGORY_MASTERS = `
  SELECT im.master_prod_id, im.name, im.attribute_name
  FROM incomplete_masters im
  JOIN master_products mp ON mp.master_prod_id = im.master_prod_id
  WHERE mp.category_id = :1
`;

// Removing a listing: discontinued = 1 plus a refund for the stock the vendor
// still holds.
//
// discontinued = 0 is in the WHERE, not in a preceding SELECT, for the same
// reason the order claim puts its predicate inside the UPDATE: it makes the
// check and the write one atomic statement, so two administrators clicking at
// once cannot both pass the check and both refund. rowCount = 0 means it was
// already removed, and the caller turns that into a 409 rather than paying
// twice.
const DISCONTINUE_LISTING = `
  UPDATE products
  SET discontinued = 1
  WHERE prod_id = :1 AND discontinued = 0
  RETURNING prod_id, shop_id, master_prod_id, in_stock
`;

const LISTING_BY_ID = `
  SELECT prod_id, discontinued FROM products WHERE prod_id = :1
`;

// LIFO cost attribution: what a listing's remaining stock actually cost.
//
// A listing's in_stock does not say which purchase rows it came from, so this
// assumes the usual inventory rule — the oldest units sell first, the newest are
// still on the shelf. Reading shop_purchases newest-first and consuming in_stock
// against each row in turn therefore says how many units of each purchase are
// still held, and at what price.
//
// Units left over after every purchase row is exhausted have no purchase record
// at all (seeded listings, or a listing stocked by direct SQL). Those fall back
// to the master's current wholesale price, which is the only price available for
// them — and is what a vendor would pay to replace that stock today.
//
// Takes an array of prod_ids so one statement serves both the refund that is
// about to be paid and the console's preview of what a removal would pay. Same
// SQL, so a preview cannot drift from the payment. `IN (:1)` is PostgreSQL's
// `= ANY($1::int[])`: src/db/execute.js expands the array into as many binds as
// it has elements.
//
// PARTITION BY shop_id, master_prod_id rather than prod_id: purchases are
// recorded against a shop and a master product, not against a listing. The
// vendor purchase path keeps one listing per (shop, master) — LISTING_FOR_MASTER
// picks one and RESTOCK_LISTING adds to it — so the two are the same thing in
// practice. Two listings of one master in one shop, which only direct SQL can
// create, would each attribute the same purchases.
//
// The three per-listing figures come back two different ways. Units are counts,
// and a count is a number. Amounts are computed money with no declared scale, so
// each is TO_CHARed — including the total, which is the sum of two strings
// added as numbers rather than as text.
const REFUND_ATTRIBUTION = `
  WITH listing AS (
    SELECT p.prod_id, p.shop_id, p.master_prod_id, p.in_stock,
           mp.wholesale_price AS fallback_price
    FROM products p
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.prod_id IN (:1)
  ),
  ranked AS (
    SELECT
      l.prod_id,
      sp.quantity,
      sp.wholesale_unit_price,
      COALESCE(SUM(sp.quantity) OVER (
        PARTITION BY sp.shop_id, sp.master_prod_id
        ORDER BY sp.purchased_at DESC, sp.purchase_id DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0) AS consumed_before
    FROM shop_purchases sp
    JOIN listing l
      ON l.shop_id = sp.shop_id
     AND l.master_prod_id = sp.master_prod_id
  ),
  held AS (
    SELECT
      l.prod_id,
      GREATEST(LEAST(l.in_stock - r.consumed_before, r.quantity), 0) AS units,
      r.wholesale_unit_price
    FROM listing l
    LEFT JOIN ranked r ON r.prod_id = l.prod_id
  ),
  attributed AS (
    SELECT
      l.prod_id,
      l.in_stock,
      l.fallback_price,
      COALESCE(SUM(held.units), 0) AS purchased_units,
      COALESCE(SUM(held.units * held.wholesale_unit_price), 0)
        AS purchased_amount
    FROM listing l
    LEFT JOIN held ON held.prod_id = l.prod_id
    GROUP BY l.prod_id, l.in_stock, l.fallback_price
  )
  SELECT
    prod_id,
    in_stock AS units,
    purchased_units,
    (in_stock - purchased_units) AS fallback_units,
    fallback_price AS fallback_unit_amount,
    ${asMoney("purchased_amount")} AS purchased_amount,
    ${asMoney("(in_stock - purchased_units) * fallback_price")}
      AS fallback_amount,
    ${asMoney("purchased_amount + (in_stock - purchased_units) * fallback_price")}
      AS amount
  FROM attributed
`;

// The stock is paid for, so it stops being the vendor's inventory. Zeroing it is
// not cosmetic: without it a later restock would add to units that have already
// been refunded once, and the next removal would pay for them a second time.
const PAID_OUT_LISTING = `
  UPDATE products SET in_stock = 0 WHERE prod_id IN (:1)
`;

// The columns refundListing needs, not just the id: FOR UPDATE here is what
// holds the rows until PAID_OUT_LISTING zeroes them.
const MASTER_LISTINGS_WITH_STOCK = `
  SELECT prod_id, shop_id, master_prod_id, in_stock
  FROM products
  WHERE master_prod_id = :1 AND in_stock > 0
  ORDER BY prod_id
  FOR UPDATE
`;

// Every listing of the master, not only the ones with stock: the point of
// discontinuing a master is that none of them may be sold any more.
const REMOVE_MASTER_LISTINGS = `
  UPDATE products
  SET discontinued = 1, in_stock = 0
  WHERE master_prod_id = :1
`;

// The refund a removal owes the shop lands in the same balance the shop spends
// from, which is what makes a removal and a wholesale purchase two movements of
// one number rather than two unrelated readings.
const CREDIT_SHOP_BALANCE = `
  UPDATE shops
  SET balance = balance + :2
  WHERE shop_id = :1
  RETURNING shop_id, balance
`;

// unit_amount is amount / units, and NULL when units is 0 — the price of no
// units is not a number — which is what the CASE says.
const CREATE_VENDOR_REFUND = `
  INSERT INTO vendor_refunds (
    shop_id, prod_id, master_prod_id, units, unit_amount, amount, reason, removed_by
  ) VALUES (
    :1, :2, :3, :4,
    CASE WHEN :4 > 0 THEN ROUND(:5 / :4, 2) END,
    :5, :6, :7
  )
  RETURNING *
`;

// The console's Shops tab expands a shop into its listings. The refund figures
// are not computed here: REFUND_ATTRIBUTION already answers that question, and
// inlining it would need a second prod_id parameter inside the same statement.
// The controller calls it for the shop's listings and merges the two results,
// the way attachMasterAttributes merges masters and attributes.
const LIST_SHOP_LISTINGS = `
  SELECT
    p.prod_id, p.name, p.in_stock, p.unit_price, p.discontinued,
    mp.master_prod_id, mp.name AS master_name, mp.wholesale_price
  FROM products p
  JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
  WHERE p.shop_id = :1
  ORDER BY p.discontinued, p.prod_id
`;

module.exports = {
  BACKFILL_CATEGORY_ATTRIBUTE,
  CATEGORY_EXISTS,
  CATEGORY_HAS_DEPENDENTS,
  CATEGORY_PARENT_CYCLE,
  CREATE_ATTRIBUTE,
  CREATE_CATEGORY,
  CREATE_CATEGORY_ATTRIBUTE,
  CREATE_MASTER,
  CREATE_MASTER_VALUE,
  CREATE_VENDOR_REFUND,
  CREDIT_SHOP_BALANCE,
  DELETE_CATEGORY,
  DELETE_CATEGORY_ATTRIBUTES,
  DELETE_MASTER_VALUES,
  DISCONTINUE_LISTING,
  DISCONTINUE_MASTER,
  INCOMPLETE_CATEGORY_MASTERS,
  INCOMPLETE_MASTER,
  LISTING_BY_ID,
  LIST_ATTRIBUTES,
  LIST_AVAILABLE_MASTERS,
  LIST_CATALOG_CATEGORIES,
  LIST_CATEGORY_ATTRIBUTES,
  LIST_MASTER_ATTRIBUTES,
  LIST_MASTERS,
  LIST_SHOP_LISTINGS,
  MASTER_LISTINGS_WITH_STOCK,
  PAID_OUT_LISTING,
  REFUND_ATTRIBUTION,
  REMOVE_MASTER_LISTINGS,
  SYNC_MASTER_LISTINGS,
  UPDATE_CATEGORY,
  UPDATE_MASTER,
};
