
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
  WHERE s.owner = $1
  ORDER BY s.shop_id
`;

const OWNED_SHOP = `
  SELECT shop_id
  FROM shops
  WHERE shop_id = $1 AND owner = $2
`;
// One shop's balance, for the recharge page. Cast so the driver's string comes
// back at two decimal places rather than at whatever scale it happens to hold.
const SHOP_BALANCE = `
  SELECT shop_id, name, balance::numeric(12,2) AS balance
  FROM shops
  WHERE shop_id = $1
`;
// active_status is deliberately absent: shop status is an administrator-only
// field. A vendor must not be able to approve their own shop, nor to undo a ban.
const UPDATE_SHOP = `
  UPDATE shops
  SET name = $1, description = $2, phone_numbers = $3, logo = $4,
      cover_photo = $5, address = $6
  WHERE shop_id = $7 AND owner = $8
  RETURNING *
`;
// A new shop waits for an administrator. It is invisible to the storefront
// because every catalog query requires active_status = 'active'.
const CREATE_SHOP = `
  INSERT INTO shops (
    name, description, phone_numbers, logo, cover_photo, address, active_status, owner
  ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
  RETURNING *
`;

const LIST_OWNED_LISTINGS = `
  SELECT p.*, s.name AS shop_name, mp.manufacturer, c.name AS category_name
  FROM products p
  JOIN shops s USING (shop_id)
  JOIN master_products mp USING (master_prod_id)
  JOIN categories c ON c.category_id = mp.category_id
  WHERE s.owner = $1
  ORDER BY p.prod_id
`;
const LIST_OWNED_PURCHASES = `
  SELECT
    sp.*,
    mp.name,
    s.name AS shop_name,
    sp.quantity * sp.wholesale_unit_price AS total
  FROM shop_purchases sp
  JOIN shops s USING (shop_id)
  JOIN master_products mp USING (master_prod_id)
  WHERE s.owner = $1
  ORDER BY sp.purchase_id DESC
`;

const ACTIVE_OWNED_SHOP = `
  SELECT shop_id
  FROM shops
  WHERE shop_id = $1 AND owner = $2 AND active_status = 'active'
`;
const AVAILABLE_MASTER = `
  SELECT *
  FROM master_products
  WHERE master_prod_id = $1 AND active_status = 'available'
`;
const LISTING_FOR_MASTER = `
  SELECT prod_id, in_stock
  FROM products
  WHERE shop_id = $1 AND master_prod_id = $2
  ORDER BY prod_id
  LIMIT 1
`;
const CREATE_PURCHASE = `
  INSERT INTO shop_purchases (
    shop_id, master_prod_id, quantity, wholesale_unit_price
  ) VALUES ($1, $2, $3, $4)
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
  SET balance = balance - $2
  WHERE shop_id = $1 AND owner = $3 AND balance >= $2
  RETURNING shop_id, balance
`;

// A recharge credits the balance and writes its ledger row. No gateway is
// involved, so these two are the whole of it.
const CREDIT_SHOP_BALANCE = `
  UPDATE shops
  SET balance = balance + $2
  WHERE shop_id = $1 AND owner = $3
  RETURNING shop_id, balance
`;
const CREATE_TOPUP = `
  INSERT INTO shop_topups (shop_id, amount, method)
  VALUES ($1, $2, $3)
  RETURNING topup_id, shop_id, amount, method, created_at
`;
// The recharge page's statement of movements, newest first. Both ledgers are
// read in one round trip and told apart by `kind`, which is what lets the page
// show a single list rather than two that have to be interleaved by hand.
const LIST_SHOP_MOVEMENTS = `
  SELECT 'sale' AS kind, o.order_id AS reference, NULL::int AS quantity,
         SUM(oi.quantity * oi.unit_price)::numeric(12,2) AS amount,
         o.delivered_at AS created_at
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN products p ON p.prod_id = oi.prod_id
  WHERE p.shop_id = $1 AND o.order_status = 'delivered'
  GROUP BY o.order_id, o.delivered_at
  UNION ALL
  SELECT 'purchase', sp.purchase_id, sp.quantity,
         (-(sp.quantity * sp.wholesale_unit_price))::numeric(12,2), sp.purchased_at
  FROM shop_purchases sp WHERE sp.shop_id = $1
  UNION ALL
  SELECT 'topup', t.topup_id, NULL,
         t.amount::numeric(12,2), t.created_at
  FROM shop_topups t WHERE t.shop_id = $1
  UNION ALL
  SELECT 'admin_refund', vr.refund_id, vr.units,
         vr.amount::numeric(12,2), vr.created_at
  FROM vendor_refunds vr WHERE vr.shop_id = $1
  UNION ALL
  -- The other direction of money: this is the shop paying a customer back, not
  -- the platform paying the shop. Same shape, opposite sign.
  SELECT 'customer_return', cr.return_id, r.quantity,
         (-cr.amount)::numeric(12,2), cr.created_at
  FROM customer_refunds cr
  JOIN product_returns r ON r.return_id = cr.return_id
  WHERE cr.shop_id = $1
  ORDER BY created_at DESC, kind
`;
const RESTOCK_LISTING = `
  UPDATE products
  SET in_stock = in_stock + $1, unit_price = $2, description = $3,
      discontinued = false, name = $4, images = $5
  WHERE prod_id = $6
  RETURNING *
`;
const CREATE_LISTING = `
  INSERT INTO products (
    name, images, master_prod_id, description, shop_id, in_stock, unit_price
  ) VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *
`;
const UPDATE_OWNED_LISTING = `
  UPDATE products p
  SET description = $1, unit_price = $2, discontinued = $3
  FROM shops s
  WHERE p.shop_id = s.shop_id
    AND s.owner = $4
    AND p.prod_id = $5
  RETURNING p.*
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
