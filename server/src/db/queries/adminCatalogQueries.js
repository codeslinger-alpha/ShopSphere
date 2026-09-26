const MASTER_SELECT = `
  SELECT mp.*, c.name AS category_name
  FROM master_products mp
  JOIN categories c USING (category_id)
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
    ca.attribute_id IS NOT NULL AS required
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
  VALUES ($1, $2)
  RETURNING *
`;
const CATEGORY_EXISTS = `SELECT 1 FROM categories WHERE category_id = $1`;
const CATEGORY_PARENT_CYCLE = `
  WITH RECURSIVE descendants AS (
    SELECT category_id FROM categories WHERE category_id = $1
    UNION
    SELECT c.category_id
    FROM categories c
    JOIN descendants d ON c.parent_category = d.category_id
  )
  SELECT 1 FROM descendants WHERE category_id = $2
`;
const UPDATE_CATEGORY = `
  UPDATE categories
  SET name = $1, description = $2, parent_category = $3
  WHERE category_id = $4
  RETURNING *
`;
const CREATE_CATEGORY = `
  INSERT INTO categories (name, description, parent_category)
  VALUES ($1, $2, $3)
  RETURNING *
`;
const DELETE_CATEGORY_ATTRIBUTES = `
  DELETE FROM category_attributes WHERE category_id = $1
`;
const CREATE_CATEGORY_ATTRIBUTE = `
  INSERT INTO category_attributes (category_id, attribute_id)
  VALUES ($1, $2)
`;
const BACKFILL_CATEGORY_ATTRIBUTE = `
  INSERT INTO attribute_values (master_prod_id, attribute_id, attrib_value)
  SELECT master_prod_id, $2, $3
  FROM master_products
  WHERE category_id = $1
  ON CONFLICT (master_prod_id, attribute_id) DO NOTHING
`;
const CATEGORY_HAS_DEPENDENTS = `
  SELECT 1 FROM categories WHERE parent_category = $1
  UNION ALL
  SELECT 1 FROM master_products WHERE category_id = $1
`;
const DELETE_CATEGORY = `
  DELETE FROM categories WHERE category_id = $1 RETURNING category_id
`;

const UPDATE_MASTER = `
  UPDATE master_products
  SET name = $1, manufacturer = $2, images = $3, description = $4,
      category_id = $5, wholesale_price = $6, active_status = $7
  WHERE master_prod_id = $8
  RETURNING *
`;
const CREATE_MASTER = `
  INSERT INTO master_products (
    name, manufacturer, images, description, category_id, wholesale_price, active_status
  ) VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *
`;
const DELETE_MASTER_VALUES = `
  DELETE FROM attribute_values WHERE master_prod_id = $1
`;
const CREATE_MASTER_VALUE = `
  INSERT INTO attribute_values (master_prod_id, attribute_id, attrib_value)
  VALUES ($1, $2, $3)
`;
const SYNC_MASTER_LISTINGS = `
  UPDATE products SET name = $1, images = $2 WHERE master_prod_id = $3
`;
const DISCONTINUE_MASTER = `
  UPDATE master_products
  SET active_status = 'discontinued'
  WHERE master_prod_id = $1
  RETURNING master_prod_id
`;

// Removing a listing: discontinued = true plus a refund for the stock the
// vendor still holds.
//
// discontinued = false is in the WHERE, not in a preceding SELECT, for the same
// reason the order claim puts its predicate inside the UPDATE: it makes the
// check and the write one atomic statement, so two administrators clicking at
// once cannot both pass the check and both refund. rowCount = 0 means it was
// already removed, and the caller turns that into a 409 rather than paying
// twice.
const DISCONTINUE_LISTING = `
  UPDATE products
  SET discontinued = true
  WHERE prod_id = $1 AND discontinued = false
  RETURNING prod_id, shop_id, master_prod_id, in_stock
`;

const LISTING_BY_ID = `
  SELECT prod_id, discontinued FROM products WHERE prod_id = $1
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
// SQL, so a preview cannot drift from the payment.
//
// PARTITION BY shop_id, master_prod_id rather than prod_id: purchases are
// recorded against a shop and a master product, not against a listing. The
// vendor purchase path keeps one listing per (shop, master) — LISTING_FOR_MASTER
// picks one and RESTOCK_LISTING adds to it — so the two are the same thing in
// practice. Two listings of one master in one shop, which only direct SQL can
// create, would each attribute the same purchases.
const REFUND_ATTRIBUTION = `
  WITH listing AS (
    SELECT p.prod_id, p.shop_id, p.master_prod_id, p.in_stock,
           mp.wholesale_price AS fallback_price
    FROM products p
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.prod_id = ANY($1::int[])
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
  line AS (
    SELECT
      l.prod_id,
      GREATEST(LEAST(l.in_stock - r.consumed_before, r.quantity), 0) AS units,
      r.wholesale_unit_price
    FROM listing l
    LEFT JOIN ranked r ON r.prod_id = l.prod_id
  ),
  total AS (
    SELECT
      l.prod_id,
      l.in_stock,
      l.fallback_price,
      COALESCE(SUM(line.units), 0) AS purchased_units,
      COALESCE(SUM(line.units * line.wholesale_unit_price), 0)
        AS purchased_amount
    FROM listing l
    LEFT JOIN line ON line.prod_id = l.prod_id
    GROUP BY l.prod_id, l.in_stock, l.fallback_price
  )
  SELECT
    prod_id,
    -- Cast, or the driver hands counts back as strings for the client to
    -- compare as text; the same reason buildShopListQuery casts its counts.
    in_stock::int AS units,
    purchased_units::int AS purchased_units,
    (in_stock - purchased_units)::int AS fallback_units,
    fallback_price AS fallback_unit_amount,
    purchased_amount::numeric(12,2) AS purchased_amount,
    ((in_stock - purchased_units) * fallback_price)::numeric(12,2)
      AS fallback_amount,
    (purchased_amount
      + (in_stock - purchased_units) * fallback_price)::numeric(12,2)
      AS amount
  FROM total
`;

// The stock is paid for, so it stops being the vendor's inventory. Zeroing it is
// not cosmetic: without it a later restock would add to units that have already
// been refunded once, and the next removal would pay for them a second time.
const PAID_OUT_LISTING = `
  UPDATE products SET in_stock = 0 WHERE prod_id = ANY($1::int[])
`;

// The columns refundListing needs, not just the id: FOR UPDATE here is what
// holds the rows until PAID_OUT_LISTING zeroes them.
const MASTER_LISTINGS_WITH_STOCK = `
  SELECT prod_id, shop_id, master_prod_id, in_stock
  FROM products
  WHERE master_prod_id = $1 AND in_stock > 0
  ORDER BY prod_id
  FOR UPDATE
`;

// Every listing of the master, not only the ones with stock: the point of
// discontinuing a master is that none of them may be sold any more.
const REMOVE_MASTER_LISTINGS = `
  UPDATE products
  SET discontinued = true, in_stock = 0
  WHERE master_prod_id = $1
`;

// The refund a removal owes the shop lands in the same balance the shop spends
// from, which is what makes a removal and a wholesale purchase two movements of
// one number rather than two unrelated readings.
const CREDIT_SHOP_BALANCE = `
  UPDATE shops
  SET balance = balance + $2
  WHERE shop_id = $1
  RETURNING shop_id, balance
`;

const CREATE_VENDOR_REFUND = `
  INSERT INTO vendor_refunds (
    shop_id, prod_id, master_prod_id, units, unit_amount, amount, reason, removed_by
  ) VALUES (
    $1, $2, $3, $4,
    CASE WHEN $4 > 0 THEN ROUND($5::numeric / $4, 2) END,
    $5, $6, $7
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
  JOIN master_products mp USING (master_prod_id)
  WHERE p.shop_id = $1
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
