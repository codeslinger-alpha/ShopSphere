
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
  LIST_OWNED_LISTINGS,
  LIST_OWNED_PURCHASES,
  LIST_OWNED_SHOPS,
  LISTING_FOR_MASTER,
  OWNED_SHOP,
  RESTOCK_LISTING,
  UPDATE_OWNED_LISTING,
  UPDATE_SHOP,
};
