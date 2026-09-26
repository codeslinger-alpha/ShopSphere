// Shop reviews. The product-review trio in reviewQueries.js, keyed on a shop
// instead of a listing, so the two read the same way.
//
// The difference worth stating: eligibility for a product review is a delivered
// order containing that product; eligibility for a shop review is a delivered
// order containing any listing from that shop. Both are enforced by a trigger on
// the table — fn_verify_shop_review_purchase in schema.sql — with the
// endpoint's own check existing only so a refusal arrives as a sentence rather
// than as a 500 from a raised exception.

const LIST_SHOP_REVIEWS = `
    SELECT sr.user_id, sr.shop_id, sr.rating, sr.review, sr.last_modified,
           u.name
    FROM shop_reviews sr
    JOIN users u ON u.user_id = sr.user_id
    WHERE sr.shop_id = $1
    ORDER BY sr.last_modified DESC
`;

const SHOP_REVIEW_ELIGIBILITY = `
    SELECT EXISTS (
      SELECT 1 FROM orders o
      JOIN order_items oi ON oi.order_id = o.order_id
      JOIN products p ON p.prod_id = oi.prod_id
      WHERE o.user_id = $1 AND p.shop_id = $2 AND o.order_status = 'delivered'
    ) AS eligible
`;

const GET_OWN_SHOP_REVIEW = `
    SELECT user_id, shop_id, rating, review, last_modified
    FROM shop_reviews WHERE user_id = $1 AND shop_id = $2
`;

const UPSERT_SHOP_REVIEW = `
    INSERT INTO shop_reviews (user_id, shop_id, rating, review)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, shop_id)
    DO UPDATE SET rating = EXCLUDED.rating, review = EXCLUDED.review
    RETURNING user_id, shop_id, rating, review, last_modified
`;

const DELETE_OWN_SHOP_REVIEW = `
    DELETE FROM shop_reviews WHERE user_id = $1 AND shop_id = $2
    RETURNING shop_id
`;

module.exports = {
  DELETE_OWN_SHOP_REVIEW,
  GET_OWN_SHOP_REVIEW,
  LIST_SHOP_REVIEWS,
  SHOP_REVIEW_ELIGIBILITY,
  UPSERT_SHOP_REVIEW,
};
