const LIST_PRODUCT_REVIEWS = "SELECT pr.*,u.name FROM product_reviews pr JOIN users u USING(user_id) WHERE pr.prod_id=$1 ORDER BY pr.last_modified DESC";
const REVIEW_ELIGIBILITY = "SELECT EXISTS(SELECT 1 FROM orders o JOIN order_items oi USING(order_id) WHERE o.user_id=$1 AND oi.prod_id=$2 AND o.order_status='delivered') AS eligible";
const GET_OWN_REVIEW = "SELECT * FROM product_reviews WHERE user_id=$1 AND prod_id=$2";
const UPSERT_REVIEW = "INSERT INTO product_reviews(user_id,prod_id,rating,review) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,prod_id) DO UPDATE SET rating=EXCLUDED.rating,review=EXCLUDED.review RETURNING *";
const DELETE_OWN_REVIEW = "DELETE FROM product_reviews WHERE user_id=$1 AND prod_id=$2 RETURNING prod_id";
module.exports = { DELETE_OWN_REVIEW, GET_OWN_REVIEW, LIST_PRODUCT_REVIEWS, REVIEW_ELIGIBILITY, UPSERT_REVIEW };
