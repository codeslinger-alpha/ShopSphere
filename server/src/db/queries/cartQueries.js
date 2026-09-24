// Only static SQL fragments are shared; request values still use $1/$2 parameters.
const CART_COLUMNS = `
    c.prod_id, c.quantity, p.name, p.unit_price, p.images, p.in_stock,
    s.name AS shop_name, c.quantity * p.unit_price AS subtotal,
    (p.discontinued = false AND s.active_status = 'active'
     AND mp.active_status = 'available' AND p.in_stock > 0) IS TRUE AS available
`;
const CART_SELECT = `
    SELECT ${CART_COLUMNS}
    FROM cart_items c
    JOIN products p ON p.prod_id = c.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
`;

const GET_CART_BY_USER_ID = `
    ${CART_SELECT}
    WHERE c.user_id = $1
    ORDER BY p.name
`;

const ADD_CART_ITEM = `
    INSERT INTO cart_items (user_id, prod_id, quantity)
    SELECT $1, p.prod_id, $3
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.prod_id = $2
      AND p.discontinued = false
      AND p.in_stock >= $3
      AND s.active_status = 'active'
      AND mp.active_status = 'available'
    ON CONFLICT (user_id, prod_id)
    DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
    WHERE cart_items.quantity <= (
        SELECT in_stock - EXCLUDED.quantity FROM products WHERE prod_id = EXCLUDED.prod_id
    )
    RETURNING user_id, prod_id, quantity
`;

const UPDATE_CART_ITEM = `
    UPDATE cart_items c
    SET quantity = $1
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE c.user_id = $2
      AND c.prod_id = $3
      AND p.prod_id = c.prod_id
      AND p.in_stock >= $1
      AND p.discontinued = false
      AND s.active_status = 'active'
      AND mp.active_status = 'available'
    RETURNING ${CART_COLUMNS}
`;

const GET_CART_ITEM_BY_PRODUCT_ID = `
    ${CART_SELECT}
    WHERE c.user_id = $1 AND c.prod_id = $2
`;

const DELETE_CART_ITEM = `
    DELETE FROM cart_items
    WHERE user_id = $1 AND prod_id = $2
    RETURNING prod_id
`;

module.exports = {
  ADD_CART_ITEM,
  DELETE_CART_ITEM,
  GET_CART_BY_USER_ID,
  GET_CART_ITEM_BY_PRODUCT_ID,
  UPDATE_CART_ITEM,
};
