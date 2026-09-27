// `discontinued` is NUMBER(1) here, where PostgreSQL had a boolean, so the
// comparisons that used to say false say 0.
//
// `available` is the same test the cart uses, as a column rather than a WHERE
// clause, and Oracle has nothing that will put true or false in a result set.
// The cast is not decoration: NUMBER(1) is what src/db/execute.js reads as a
// boolean on the way out, so the cast is what keeps this field a boolean in the
// JSON rather than a 1 or a 0.
const AVAILABLE = `CAST(CASE WHEN p.discontinued = 0 AND s.active_status = 'active'
            AND mp.active_status = 'available' THEN 1 ELSE 0 END AS NUMBER(1)) AS available`;

const GET_WISHLIST_BY_USER_ID = `
    SELECT w.prod_id, p.name, p.unit_price, p.images, p.in_stock,
           s.name AS shop_name,
           ${AVAILABLE}
    FROM wish_list_items w
    JOIN products p ON p.prod_id = w.prod_id
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE w.user_id = :1
    ORDER BY p.name
`;

// PostgreSQL said ON CONFLICT DO NOTHING, which is "insert unless it is already
// there, and tell me nothing if it was". Oracle's MERGE can say the first half
// but cannot return what it wrote, so the test moves into the SELECT: the insert
// simply finds no row to insert when the wishlist already has one. The RETURNING
// clause follows — an insert that inserted nothing reports no row, which is
// exactly what DO NOTHING reported.
const ADD_WISHLIST_ITEM = `
    INSERT INTO wish_list_items (user_id, prod_id)
    SELECT :1, p.prod_id
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.prod_id = :2
      AND p.discontinued = 0
      AND s.active_status = 'active'
      AND mp.active_status = 'available'
      AND NOT EXISTS (
        SELECT 1 FROM wish_list_items w
        WHERE w.user_id = :1 AND w.prod_id = p.prod_id)
    RETURNING user_id, prod_id
`;

const WISHLIST_ITEM_EXISTS = `
    SELECT 1
    FROM wish_list_items
    WHERE user_id = :1 AND prod_id = :2
`;

const PRODUCT_EXISTS = `
    SELECT prod_id
    FROM products
    WHERE prod_id = :1
`;

const DELETE_WISHLIST_ITEM = `
    DELETE FROM wish_list_items
    WHERE user_id = :1 AND prod_id = :2
    RETURNING prod_id
`;

module.exports = {
  ADD_WISHLIST_ITEM,
  DELETE_WISHLIST_ITEM,
  GET_WISHLIST_BY_USER_ID,
  PRODUCT_EXISTS,
  WISHLIST_ITEM_EXISTS,
};
