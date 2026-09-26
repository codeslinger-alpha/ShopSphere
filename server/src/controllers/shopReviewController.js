const transaction = require("../db/transaction");
const pool = require("../db/pool");
const v = require("../utils/input");
const q = require("../db/queries/shopReviewQueries");

// Mirrors reviewController.js, keyed on a shop. The eligibility rule is the same
// one the trigger enforces; this copy exists so an ineligible customer is told
// why instead of being handed a database exception.

async function list(req, res) {
  res.json(
    (await pool.query(q.LIST_SHOP_REVIEWS, [v.id(req.params.shopId, "Shop")]))
      .rows,
  );
}

async function eligibility(req, res) {
  const shopId = v.id(req.params.shopId, "Shop");
  const result = await pool.query(q.SHOP_REVIEW_ELIGIBILITY, [
    req.user.user_id,
    shopId,
  ]);
  const review = await pool.query(q.GET_OWN_SHOP_REVIEW, [
    req.user.user_id,
    shopId,
  ]);
  res.json({ eligible: result.rows[0].eligible, review: review.rows[0] || null });
}

async function save(req, res) {
  const shopId = v.id(req.params.shopId, "Shop");
  const rating = v.id(req.body?.rating, "Rating");
  if (rating > 5) v.fail(400, "Rating must be between 1 and 5.");
  const review = v.string(req.body?.review, "Review", 10000);

  // Refuse before writing, naming the rule. The trigger would refuse anyway, but
  // an uncaught raise_exception becomes a 500, and "you have not bought anything
  // from this shop" is a 403 the client can act on.
  const { eligible } = (
    await pool.query(q.SHOP_REVIEW_ELIGIBILITY, [req.user.user_id, shopId])
  ).rows[0];
  if (!eligible)
    v.fail(
      403,
      "Only customers with a delivered order from this shop can review it.",
    );

  const result = await transaction.query(q.UPSERT_SHOP_REVIEW, [
    req.user.user_id,
    shopId,
    rating,
    review,
  ]);
  res.json({ message: "Shop review saved.", review: result.rows[0] });
}

async function remove(req, res) {
  if (
    !(
      await transaction.query(q.DELETE_OWN_SHOP_REVIEW, [
        req.user.user_id,
        v.id(req.params.shopId, "Shop"),
      ])
    ).rowCount
  )
    v.fail(404, "Your shop review was not found.");
  res.status(204).send();
}

module.exports = { eligibility, list, remove, save };
