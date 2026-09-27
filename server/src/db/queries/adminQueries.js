const { escapeLikePattern } = require("../sql");

const USER_STATUSES = ["active", "disabled"];
const SHOP_STATUSES = ["active", "disabled", "pending"];

// The admin lists mirror the catalog's builders: parameters are pushed in
// statement order, COUNT(*) OVER() brings the total back in the same round
// trip, and the ORDER BY is chosen from a fixed string rather than interpolated
// from input.
//
// Two spellings differ from the PostgreSQL these were written against, and both
// are mechanical. ILIKE is LOWER(x) LIKE LOWER(:n), because Oracle has no
// case-insensitive LIKE. LIMIT n OFFSET m is OFFSET m ROWS FETCH NEXT n ROWS
// ONLY, which is the standard spelling Oracle implements — and it is the reason
// the two bind positions swap over in the clause.

function buildUserListQuery({ q, role, status, page, limit }) {
  const values = [];
  const conditions = [];

  if (q) {
    values.push(`%${escapeLikePattern(q)}%`);
    const term = `:${values.length}`;
    conditions.push(`(LOWER(u.name) LIKE LOWER(${term}) ESCAPE '\\'
        OR LOWER(u.email) LIKE LOWER(${term}) ESCAPE '\\')`);
  }

  if (role) {
    values.push(role);
    conditions.push(`r.role_name = :${values.length}`);
  }

  if (status) {
    values.push(status);
    conditions.push(`u.active_status = :${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  values.push(limit, (page - 1) * limit);

  return {
    text: `
      SELECT u.user_id, u.name, u.email, u.active_status, u.created_at,
             r.role_name,
             COUNT(*) OVER() AS total_count
      FROM users u
      LEFT JOIN roles r ON r.role_id = u.user_role
      ${where}
      ORDER BY u.user_id
      OFFSET :${values.length} ROWS FETCH NEXT :${values.length - 1} ROWS ONLY
    `,
    values,
  };
}

// Listings are counted in the same query so the console can warn how much a
// shop ban would discontinue before the admin commits to it.
function buildShopListQuery({ q, status, page, limit }) {
  const values = [];
  const conditions = [];

  if (q) {
    values.push(`%${escapeLikePattern(q)}%`);
    const term = `:${values.length}`;
    conditions.push(`(LOWER(s.name) LIKE LOWER(${term}) ESCAPE '\\'
        OR LOWER(u.name) LIKE LOWER(${term}) ESCAPE '\\'
        OR LOWER(u.email) LIKE LOWER(${term}) ESCAPE '\\')`);
  }

  if (status) {
    values.push(status);
    conditions.push(`s.active_status = :${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  values.push(limit, (page - 1) * limit);

  return {
    text: `
      SELECT s.shop_id, s.name, s.active_status, s.created_at, s.balance,
             u.user_id AS owner_id, u.name AS owner_name, u.email AS owner_email,
             u.active_status AS owner_status,
             l.city, l.country_id,
             (SELECT COUNT(*) FROM products p WHERE p.shop_id = s.shop_id) AS listing_count,
             (SELECT COUNT(*) FROM products p
              WHERE p.shop_id = s.shop_id AND p.discontinued = 0) AS active_listing_count,
             COUNT(*) OVER() AS total_count
      FROM shops s
      JOIN users u ON u.user_id = s.owner
      LEFT JOIN locations l ON l.location_id = s.address
      ${where}
      ORDER BY s.shop_id DESC
      OFFSET :${values.length} ROWS FETCH NEXT :${values.length - 1} ROWS ONLY
    `,
    values,
  };
}

const UPDATE_USER_STATUS = `
    UPDATE users
    SET active_status = :1, token_version = token_version + 1
    WHERE user_id = :2
    RETURNING user_id, name, email, active_status
`;

const FIND_SHOP_BY_ID = `
    SELECT shop_id, name, active_status
    FROM shops
    WHERE shop_id = :1
`;

const UPDATE_SHOP_STATUS = `
    UPDATE shops
    SET active_status = :1
    WHERE shop_id = :2
    RETURNING shop_id, name, active_status
`;

module.exports = {
  SHOP_STATUSES,
  USER_STATUSES,
  FIND_SHOP_BY_ID,
  UPDATE_SHOP_STATUS,
  UPDATE_USER_STATUS,
  buildShopListQuery,
  buildUserListQuery,
};
