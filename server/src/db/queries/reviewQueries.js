const oracledb = require("oracledb");

const LIST_PRODUCT_REVIEWS = `
    SELECT pr.*, u.name
    FROM product_reviews pr
    JOIN users u ON u.user_id = pr.user_id
    WHERE pr.prod_id = :1
    ORDER BY pr.last_modified DESC
`;

// `EXISTS (...) AS eligible` is not something Oracle will put in a result set:
// there is no boolean type to put there. The test becomes a CASE and the CASE is
// cast to NUMBER(1), which is the type src/db/execute.js reads back as true and
// false — so the controller's `if (!eligible)` still means what it reads as.
const REVIEW_ELIGIBILITY = `
    SELECT CAST(CASE WHEN EXISTS (
        SELECT 1 FROM orders o
        JOIN order_items oi ON oi.order_id = o.order_id
        WHERE o.user_id = :1 AND oi.prod_id = :2 AND o.order_status = 'delivered')
      THEN 1 ELSE 0 END AS NUMBER(1)) AS eligible
    FROM dual
`;

const GET_OWN_REVIEW = `
    SELECT * FROM product_reviews WHERE user_id = :1 AND prod_id = :2
`;

// PostgreSQL wrote this as one statement, INSERT ... ON CONFLICT DO UPDATE ...
// RETURNING, and Oracle has no statement that both merges and reports what it
// merged: MERGE cannot RETURN. So it is a block of two — the MERGE writes, and
// the SELECT reports the row the caller was promised, which is the same row
// ON CONFLICT would have returned whether it had been inserted or updated.
//
// The trigger on product_reviews stamps last_modified as part of the MERGE's own
// write, so the SELECT reads the stamp rather than the block inventing one.
//
// The review is bound as a CLOB explicitly. It may be ten thousand characters,
// which is past what a VARCHAR2 bind holds, and the column is a CLOB.
const UPSERT_REVIEW = {
  text: `
    BEGIN
      MERGE INTO product_reviews pr
      USING (SELECT :bind_user_id AS user_id, :bind_prod_id AS prod_id FROM dual) src
      ON (pr.user_id = src.user_id AND pr.prod_id = src.prod_id)
      WHEN MATCHED THEN
        UPDATE SET rating = :bind_rating, review = :bind_review
      WHEN NOT MATCHED THEN
        INSERT (user_id, prod_id, rating, review)
        VALUES (src.user_id, src.prod_id, :bind_rating, :bind_review);

      SELECT user_id, prod_id, rating, review, last_modified
      INTO :user_id, :prod_id, :rating, :review, :last_modified
      FROM product_reviews
      WHERE user_id = :bind_user_id AND prod_id = :bind_prod_id;
    END;
  `,
  binds: (userId, prodId, rating, review) => ({
    bind_user_id: userId,
    bind_prod_id: prodId,
    bind_rating: rating,
    bind_review: { val: review, type: oracledb.DB_TYPE_CLOB },
    user_id: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
    prod_id: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
    rating: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
    review: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_CLOB },
    last_modified: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_TIMESTAMP },
  }),
};

const DELETE_OWN_REVIEW = `
    DELETE FROM product_reviews WHERE user_id = :1 AND prod_id = :2
    RETURNING prod_id
`;

module.exports = {
  DELETE_OWN_REVIEW,
  GET_OWN_REVIEW,
  LIST_PRODUCT_REVIEWS,
  REVIEW_ELIGIBILITY,
  UPSERT_REVIEW,
};
