const oracledb = require("oracledb");

// Only static SQL fragments are shared; request values still use :1/:2 binds.
//
// Two things in this file are Oracle's doing rather than the cart's:
//
//   * subtotal is formatted, because a product of two NUMBERs arrives with
//     whatever scale Oracle computes for it and the client has always had this
//     one as a two-decimal string.
//   * available is a CASE cast to NUMBER(1). PostgreSQL had a boolean to put in
//     a result set; Oracle has none, and NUMBER(1) is what src/db/execute.js
//     reads back as true and false.
const CART_COLUMNS = `
    c.prod_id, c.quantity, p.name, p.unit_price, p.images, p.in_stock,
    s.name AS shop_name,
    TO_CHAR(c.quantity * p.unit_price, 'FM9999999990.00') AS subtotal,
    CAST(CASE WHEN p.discontinued = 0 AND s.active_status = 'active'
              AND mp.active_status = 'available' AND p.in_stock > 0
         THEN 1 ELSE 0 END AS NUMBER(1)) AS available
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
    WHERE c.user_id = :1
    ORDER BY p.name
`;

// PostgreSQL wrote this as INSERT ... ON CONFLICT (user_id, prod_id) DO UPDATE
// ... WHERE cart_items.quantity <= in_stock - EXCLUDED.quantity, RETURNING the
// row — or nothing, when the top-up would have run past the stock. Oracle has no
// one statement that does all of that: MERGE cannot RETURN, and the conflict has
// to be caught rather than declared.
//
// So it is a block. DUP_VAL_ON_INDEX is the conflict branch, and it is also what
// makes this race-free in the way ON CONFLICT was: a second request arriving at
// the same moment waits on the row, is told the key already exists, and takes the
// top-up path. `v_written` carries the other half of the PostgreSQL statement —
// the guarded top-up that matches nothing is still a cart the caller must be told
// about, so no row comes back and the controller answers 409.
const ADD_CART_ITEM = {
  text: `
    DECLARE
      v_available NUMBER;
      v_written   NUMBER := 0;
    BEGIN
      SELECT COUNT(*) INTO v_available
      FROM products p
      JOIN shops s ON s.shop_id = p.shop_id
      JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
      WHERE p.prod_id = :bind_prod_id
        AND p.discontinued = 0
        AND p.in_stock >= :bind_quantity
        AND s.active_status = 'active'
        AND mp.active_status = 'available';

      IF v_available > 0 THEN
        BEGIN
          INSERT INTO cart_items (user_id, prod_id, quantity)
          VALUES (:bind_user_id, :bind_prod_id, :bind_quantity);
          v_written := 1;
        EXCEPTION WHEN DUP_VAL_ON_INDEX THEN
          UPDATE cart_items
          SET quantity = quantity + :bind_quantity
          WHERE user_id = :bind_user_id AND prod_id = :bind_prod_id
            AND quantity + :bind_quantity <= (
              SELECT in_stock FROM products WHERE prod_id = :bind_prod_id);
          v_written := SQL%ROWCOUNT;
        END;

        IF v_written > 0 THEN
          SELECT user_id, prod_id, quantity
          INTO :user_id, :prod_id, :quantity
          FROM cart_items
          WHERE user_id = :bind_user_id AND prod_id = :bind_prod_id;
        END IF;
      END IF;
    END;
  `,
  binds: (userId, prodId, quantity) => ({
    bind_user_id: userId,
    bind_prod_id: prodId,
    bind_quantity: quantity,
    user_id: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
    prod_id: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
    quantity: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
  }),
};

// The guard survives the port; the RETURNING clause does not, because Oracle
// will not return an expression from an UPDATE and every column this row is
// reported with except prod_id is one. So the statement reports the id it moved
// and the controller reads the row back — two statements in the transaction the
// controller already had, and the availability rule still inside the UPDATE's
// own predicate where it cannot go stale.
//
// The cart row is named by its table rather than by an alias: Oracle's SET
// clause takes a bare column name, so there is no alias for the EXISTS to
// correlate through.
const UPDATE_CART_ITEM = `
    UPDATE cart_items
    SET quantity = :1
    WHERE user_id = :2
      AND prod_id = :3
      AND EXISTS (
        SELECT 1 FROM products p
        WHERE p.prod_id = cart_items.prod_id
          AND p.in_stock >= :1
          AND p.discontinued = 0
          AND EXISTS (
            SELECT 1 FROM shops s
            WHERE s.shop_id = p.shop_id AND s.active_status = 'active')
          AND EXISTS (
            SELECT 1 FROM master_products mp
            WHERE mp.master_prod_id = p.master_prod_id
              AND mp.active_status = 'available'))
    RETURNING prod_id
`;

const GET_CART_ITEM_BY_PRODUCT_ID = `
    ${CART_SELECT}
    WHERE c.user_id = :1 AND c.prod_id = :2
`;

const DELETE_CART_ITEM = `
    DELETE FROM cart_items
    WHERE user_id = :1 AND prod_id = :2
    RETURNING prod_id
`;

module.exports = {
  ADD_CART_ITEM,
  DELETE_CART_ITEM,
  GET_CART_BY_USER_ID,
  GET_CART_ITEM_BY_PRODUCT_ID,
  UPDATE_CART_ITEM,
};
