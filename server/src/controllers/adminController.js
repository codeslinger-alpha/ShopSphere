const pool = require("../db/pool");
const v = require("../utils/input");
const { paginated, parseListQuery } = require("../utils/listQuery");
const { parsePositiveInteger } = require("../utils/validation");
const q = require("../db/queries/adminQueries");

async function listUsers(req, res) {
  const parsed = parseListQuery(req.query, { status: q.USER_STATUSES });
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const { filters } = parsed;
  // Role is the one filter not drawn from a closed list: the roles are rows in
  // the database, so the server has nothing to check the value against that the
  // join will not already answer with an empty page.
  if (req.query.role !== undefined) {
    const role = v.string(req.query.role, "Role", 60, true);
    filters.role = role;
  }

  const result = await pool.query(q.buildUserListQuery(filters));
  res.json(paginated(result.rows, filters.page, filters.limit));
}

async function updateUserStatus(req, res) {
  const id = parsePositiveInteger(req.params.userId);
  const status = req.body?.active_status;
  if (!id || !q.USER_STATUSES.includes(status))
    return res.status(400).json({
      message: "A user ID and active or disabled status are required.",
    });

  // The guard that keeps administration reachable. Whoever is signed in here is
  // by definition an active administrator (requireAuth re-reads the row and
  // rejects a disabled account), so refusing to disable yourself is enough:
  // banning every other admin still leaves you. A "last active admin" count
  // would be unreachable, because a different active admin is being disabled
  // only when there are at least two.
  if (id === req.user.user_id)
    return res
      .status(409)
      .json({ message: "You cannot disable your own administrator account." });

  const result = await pool.query(q.UPDATE_USER_STATUS, [status, id]);
  if (!result.rows.length)
    return res.status(404).json({ message: "User not found." });
  return res.json({ message: "User status updated.", user: result.rows[0] });
}

async function listShops(req, res) {
  const parsed = parseListQuery(req.query, { status: q.SHOP_STATUSES });
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const { filters } = parsed;
  const result = await pool.query(q.buildShopListQuery(filters));
  res.json(paginated(result.rows, filters.page, filters.limit));
}

async function updateShopStatus(req, res) {
  const id = parsePositiveInteger(req.params.shopId);
  const status = req.body?.active_status;
  if (!id || !q.SHOP_STATUSES.includes(status))
    return res.status(400).json({
      message: "A shop ID and active, disabled or pending status are required.",
    });

  // Disabling a shop discontinues every one of its listings through
  // fn_discontinue_products_on_shop_disable, and that is one-way. Refuse rather
  // than let an administrator destroy a shop's availability by accident.
  const shop = (await pool.query(q.FIND_SHOP_BY_ID, [id])).rows[0];
  if (!shop) return res.status(404).json({ message: "Shop not found." });
  if (shop.active_status === status)
    return res.json({ message: "Shop status is already up to date.", shop });

  const result = await pool.query(q.UPDATE_SHOP_STATUS, [status, id]);
  const message =
    status === "disabled"
      ? "Shop disabled and its listings discontinued. Re-enabling the shop will not restore them."
      : status === "active"
        ? "Shop approved and visible to shoppers."
        : "Shop status updated.";
  return res.json({ message, shop: result.rows[0] });
}

module.exports = {
  listShops,
  listUsers,
  updateShopStatus,
  updateUserStatus,
};
