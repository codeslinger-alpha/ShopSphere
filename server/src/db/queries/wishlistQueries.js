const GET_WISHLIST_BY_USER_ID = `
    SELECT w.prod_id, p.name, p.unit_price, p.images, p.in_stock,
           s.name AS shop_name,
           (p.discontinued = false AND s.active_status = 'active'
            AND mp.active_status = 'available') IS TRUE AS available
    FROM wish_list_items w
    JOIN products p ON p.prod_id = w.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE w.user_id = $1
    ORDER BY p.name
`;

const ADD_WISHLIST_ITEM = `
    INSERT INTO wish_list_items (user_id, prod_id)
    SELECT $1, p.prod_id
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.prod_id = $2
      AND p.discontinued = false
      AND s.active_status = 'active'
      AND mp.active_status = 'available'
    ON CONFLICT (user_id, prod_id) DO NOTHING
    RETURNING user_id, prod_id
`;

const WISHLIST_ITEM_EXISTS = `
    SELECT 1
    FROM wish_list_items
    WHERE user_id = $1 AND prod_id = $2
`;

const PRODUCT_EXISTS = `
    SELECT prod_id
    FROM products
    WHERE prod_id = $1
`;

const DELETE_WISHLIST_ITEM = `
    DELETE FROM wish_list_items
    WHERE user_id = $1 AND prod_id = $2
    RETURNING prod_id
`;

module.exports = {
  ADD_WISHLIST_ITEM,
  DELETE_WISHLIST_ITEM,
  GET_WISHLIST_BY_USER_ID,
  PRODUCT_EXISTS,
  WISHLIST_ITEM_EXISTS,
};
