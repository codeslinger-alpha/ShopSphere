const oracledb = require("oracledb");

// Shop reviews. The product-review trio in reviewQueries.js, keyed on a shop
// instead of a listing, so the two read the same way.
//
// The difference worth stating: eligibility for a product review is a delivered
// order containing that product; eligibility for a shop review is a delivered
// order containing any listing from that shop. Both are enforced by a trigger on
// the table — trg_verify_shop_review_purchase in schema.sql — with the
// endpoint's own check existing only so a refusal arrives as a sentence rather
// than as a 500 from a raised exception.

const LIST_SHOP_REVIEWS = `
    SELECT sr.user_id, sr.shop_id, sr.rating, sr.review, sr.last_modified,
           u.name
    FROM shop_reviews sr
    JOIN users u ON u.user_id = sr.user_id
    WHERE sr.shop_id = :1
    ORDER BY sr.last_modified DESC
`;

// Cast for the same reason REVIEW_ELIGIBILITY is: the controller branches on
// this value, and Oracle has no boolean for it to branch on unless the CASE is
// declared to be one.
const SHOP_REVIEW_ELIGIBILITY = `
    SELECT CAST(CASE WHEN EXISTS (
        SELECT 1 FROM orders o
        JOIN order_items oi ON oi.order_id = o.order_id
        JOIN products p ON p.prod_id = oi.prod_id
        WHERE o.user_id = :1 AND p.shop_id = :2 AND o.order_status = 'delivered')
      THEN 1 ELSE 0 END AS NUMBER(1)) AS eligible
    FROM dual
`;

const GET_OWN_SHOP_REVIEW = `
    SELECT user_id, shop_id, rating, review, last_modified
    FROM shop_reviews WHERE user_id = :1 AND shop_id = :2
`;

// The same block as UPSERT_REVIEW, keyed on a shop: see the note there for why
// the merge and the read that follows it are two statements in one block.
const UPSERT_SHOP_REVIEW = {
  text: `
    BEGIN
      MERGE INTO shop_reviews sr
      USING (SELECT :bind_user_id AS user_id, :bind_shop_id AS shop_id FROM dual) src
      ON (sr.user_id = src.user_id AND sr.shop_id = src.shop_id)
      WHEN MATCHED THEN
        UPDATE SET rating = :bind_rating, review = :bind_review
      WHEN NOT MATCHED THEN
        INSERT (user_id, shop_id, rating, review)
        VALUES (src.user_id, src.shop_id, :bind_rating, :bind_review);

      SELECT user_id, shop_id, rating, review, last_modified
      INTO :user_id, :shop_id, :rating, :review, :last_modified
      FROM shop_reviews
      WHERE user_id = :bind_user_id AND shop_id = :bind_shop_id;
    END;
  `,
  binds: (userId, shopId, rating, review) => ({
    bind_user_id: userId,
    bind_shop_id: shopId,
    bind_rating: rating,
    bind_review: { val: review, type: oracledb.DB_TYPE_CLOB },
    user_id: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
    shop_id: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
    rating: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
    review: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_CLOB },
    last_modified: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_TIMESTAMP },
  }),
};

const DELETE_OWN_SHOP_REVIEW = `
    DELETE FROM shop_reviews WHERE user_id = :1 AND shop_id = :2
    RETURNING shop_id
`;

module.exports = {
  DELETE_OWN_SHOP_REVIEW,
  GET_OWN_SHOP_REVIEW,
  LIST_SHOP_REVIEWS,
  SHOP_REVIEW_ELIGIBILITY,
  UPSERT_SHOP_REVIEW,
};
