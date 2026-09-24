const pool = require("../config/db");
const transaction = require("../utils/transaction");
const v = require("../utils/input");
const { CREATE_LOCATION } = require("../queries/authQueries");
const q = require("../queries/vendorQueries");
async function shops(req, res) {
  res.json((await pool.query(q.LIST_OWNED_SHOPS, [req.user.user_id])).rows);
}
async function saveShop(req, res) {
  const b = req.body || {},
    id = req.params.shopId ? v.id(req.params.shopId) : null;
  const values = [
    v.string(b.name, "Shop name", 120, true),
    v.string(b.description, "Shop description", 20000),
    v.phone(b.phone_numbers),
    v.url(b.logo, "Logo URL"),
    v.url(b.cover_photo, "Cover photo URL"),
  ];
  // active_status is not read from the body. New shops start 'pending' and only
  // an administrator can approve, disable or restore one, so a vendor can never
  // activate their own shop or reverse a ban.
  const address = v.address(b);
  const shop = await transaction(async (c) => {
    if (
      id &&
      !(await c.query(q.OWNED_SHOP, [id, req.user.user_id])).rowCount
    )
      v.fail(404, "Your shop was not found.");
    const location = (await c.query(CREATE_LOCATION, address)).rows[0]
      .location_id;
    return (
      id
        ? await c.query(q.UPDATE_SHOP, [...values, location, id, req.user.user_id])
        : await c.query(q.CREATE_SHOP, [...values, location, req.user.user_id])
    ).rows[0];
  });
  const message = id
    ? "Shop saved."
    : "Shop submitted. An administrator will review it before it goes live.";
  res.status(id ? 200 : 201).json({ message, shop });
}
async function listings(req, res) {
  res.json((await pool.query(q.LIST_OWNED_LISTINGS, [req.user.user_id])).rows);
}
async function purchases(req, res) {
  res.json((await pool.query(q.LIST_OWNED_PURCHASES, [req.user.user_id])).rows);
}
async function buy(req, res) {
  const b = req.body || {},
    shopId = v.id(b.shop_id, "Shop"),
    masterId = v.id(b.master_prod_id, "Master product"),
    quantity = v.id(b.quantity, "Quantity"),
    price = v.money(b.unit_price),
    description = v.string(b.description, "Seller description", 20000);
  const listing = await transaction(async (c) => {
    if (
      !(await c.query(q.ACTIVE_OWNED_SHOP, [shopId, req.user.user_id]))
        .rowCount
    )
      v.fail(404, "Your active shop was not found.");
    const master = (await c.query(q.AVAILABLE_MASTER, [masterId])).rows[0];
    if (!master) v.fail(404, "Available master product not found.");
    const existing = (
      await c.query(q.LISTING_FOR_MASTER, [shopId, masterId])
    ).rows[0];
    if (existing && existing.in_stock + quantity > 2147483647)
      v.fail(409, "This purchase exceeds the inventory limit.");
    await c.query(q.CREATE_PURCHASE, [
      shopId,
      masterId,
      quantity,
      master.wholesale_price,
    ]);
    return (
      existing
        ? await c.query(q.RESTOCK_LISTING, [
            quantity,
            price,
            description,
            master.name,
            master.images,
            existing.prod_id,
          ])
        : await c.query(q.CREATE_LISTING, [
            master.name,
            master.images,
            masterId,
            description,
            shopId,
            quantity,
            price,
          ])
    ).rows[0];
  });
  res.status(201).json({
    message:
      "Wholesale purchase recorded and listing stocked. No online payment was charged.",
    listing,
  });
}
async function updateListing(req, res) {
  const b = req.body || {};
  if (typeof b.discontinued !== "boolean")
    v.fail(400, "Listing discontinued status must be true or false.");
  const result = await pool.query(q.UPDATE_OWNED_LISTING, [
    v.string(b.description, "Description", 20000),
    v.money(b.unit_price),
    b.discontinued,
    req.user.user_id,
    v.id(req.params.productId),
  ]);
  if (!result.rowCount) v.fail(404, "Your listing was not found.");
  res.json({ message: "Listing saved.", listing: result.rows[0] });
}
module.exports = { shops, saveShop, listings, purchases, buy, updateListing };
