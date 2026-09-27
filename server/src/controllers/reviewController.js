const transaction = require("../db/transaction");
const pool = require("../db/pool");
const v = require("../utils/input");
const q = require("../db/queries/reviewQueries");
async function list(req, res) {
  res.json(
    (
      await pool.query(q.LIST_PRODUCT_REVIEWS, [v.id(req.params.productId)])
    ).rows,
  );
}
async function eligibility(req, res) {
  const id = v.id(req.params.productId);
  const result = await pool.query(
    q.REVIEW_ELIGIBILITY,
    [req.user.user_id, id],
  );
  const review = await pool.query(
    q.GET_OWN_REVIEW,
    [req.user.user_id, id],
  );
  res.json({
    eligible: result.rows[0].eligible,
    review: review.rows[0] || null,
  });
}
async function save(req, res) {
  const rating = v.id(req.body?.rating, "Rating");
  if (rating > 5) v.fail(400, "Rating must be between 1 and 5.");
  const review = v.string(req.body?.review, "Review", 10000);
  // The upsert is PL/SQL — Oracle's MERGE cannot report the row it wrote — so it
  // carries its own binds, which is the only place that knows the review column
  // is a CLOB.
  const result = await transaction.query(
    q.UPSERT_REVIEW.text,
    q.UPSERT_REVIEW.binds(
      req.user.user_id,
      v.id(req.params.productId),
      rating,
      review,
    ),
  );
  res.json({ message: "Review saved.", review: result.rows[0] });
}
async function remove(req, res) {
  if (
    !(
      await transaction.query(
        q.DELETE_OWN_REVIEW,
        [req.user.user_id, v.id(req.params.productId)],
      )
    ).rowCount
  )
    v.fail(404, "Your review was not found.");
  res.status(204).send();
}
module.exports = { list, eligibility, save, remove };
