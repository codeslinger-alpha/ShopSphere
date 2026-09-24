const pool = require("../db/pool");
const transaction = require("../db/transaction");
const v = require("../utils/input");
const q = require("../db/queries/adminCatalogQueries");
function attachMasterAttributes(masters, rows) {
  const attributesByMaster = new Map();
  for (const row of rows) {
    const attributes = attributesByMaster.get(row.master_prod_id) || [];
    attributes.push({
      attribute_id: row.attribute_id,
      name: row.name,
      description: row.description,
      attrib_value: row.attrib_value,
      required: row.required,
    });
    attributesByMaster.set(row.master_prod_id, attributes);
  }
  return masters.map((master) => ({
    ...master,
    attributes: attributesByMaster.get(master.master_prod_id) || [],
  }));
}
async function listMasters(req, res) {
  const [masters, attributes] = await Promise.all([
    pool.query(q.LIST_MASTERS),
    pool.query(q.LIST_MASTER_ATTRIBUTES),
  ]);
  res.json(attachMasterAttributes(masters.rows, attributes.rows));
}
async function availableMasters(req, res) {
  const [masters, attributes] = await Promise.all([
    pool.query(q.LIST_AVAILABLE_MASTERS),
    pool.query(q.LIST_MASTER_ATTRIBUTES),
  ]);
  res.json(attachMasterAttributes(masters.rows, attributes.rows));
}
async function metadata(req, res) {
  const [categories, attributes, links] = await Promise.all([
    pool.query(q.LIST_CATALOG_CATEGORIES),
    pool.query(q.LIST_ATTRIBUTES),
    pool.query(q.LIST_CATEGORY_ATTRIBUTES),
  ]);
  const idsByCategory = new Map();
  for (const link of links.rows) {
    const ids = idsByCategory.get(link.category_id) || [];
    ids.push(link.attribute_id);
    idsByCategory.set(link.category_id, ids);
  }
  res.json({
    categories: categories.rows.map((category) => ({
      ...category,
      attribute_ids: idsByCategory.get(category.category_id) || [],
    })),
    attributes: attributes.rows,
  });
}
async function createAttribute(req, res) {
  const name = v.string(req.body?.name, "Attribute name", 100, true),
    description = v.string(
      req.body?.description,
      "Attribute description",
      2000,
    );
  res.status(201).json({
    message: "Attribute created.",
    attribute: (
      await pool.query(q.CREATE_ATTRIBUTE, [name, description])
    ).rows[0],
  });
}
async function saveCategory(req, res) {
  const b = req.body || {},
    categoryId = req.params.categoryId ? v.id(req.params.categoryId) : null;
  const name = v.string(b.name, "Category name", 120, true),
    description = v.string(b.description, "Description", 5000);
  const parent =
    b.parent_category === undefined ||
    b.parent_category === null ||
    b.parent_category === ""
      ? null
      : v.id(b.parent_category, "Parent category");
  if (
    !Array.isArray(b.required_attributes) ||
    b.required_attributes.length > 100
  )
    v.fail(400, "Required attributes must be an array of at most 100 entries.");
  const required = b.required_attributes.map((a) => ({
    id: v.id(a?.attribute_id, "Attribute"),
    value: v.string(a?.default_value, "Value for existing products", 500),
  }));
  if (new Set(required.map((a) => a.id)).size !== required.length)
    v.fail(400, "Choose each required attribute once.");
  const category = await transaction(async (c) => {
    if (
      categoryId &&
      !(
        await c.query(q.CATEGORY_EXISTS, [categoryId])
      ).rowCount
    )
      v.fail(404, "Category not found.");
    if (parent && categoryId) {
      const cycle = await c.query(q.CATEGORY_PARENT_CYCLE, [categoryId, parent]);
      if (cycle.rowCount) v.fail(400, "A category cannot be its own ancestor.");
    }
    const result = categoryId
        ? await c.query(q.UPDATE_CATEGORY, [name, description, parent, categoryId])
      : await c.query(q.CREATE_CATEGORY, [name, description, parent]);
    const category = result.rows[0];
    await c.query(q.DELETE_CATEGORY_ATTRIBUTES, [category.category_id]);
    for (const a of required) {
      await c.query(
        q.CREATE_CATEGORY_ATTRIBUTE,
        [category.category_id, a.id],
      );
      if (a.value)
        await c.query(
          q.BACKFILL_CATEGORY_ATTRIBUTE,
          [category.category_id, a.id, a.value],
        );
    }
    return category;
  });
  res
    .status(categoryId ? 200 : 201)
    .json({ message: "Category and required attributes saved.", category });
}
async function deleteCategory(req, res) {
  const id = v.id(req.params.categoryId);
  await transaction(async (c) => {
    if (
      (
        await c.query(
          q.CATEGORY_HAS_DEPENDENTS,
          [id],
        )
      ).rowCount
    )
      v.fail(
        409,
        "Move child categories and master products before deleting this category.",
      );
    if (
      !(
        await c.query(
          q.DELETE_CATEGORY,
          [id],
        )
      ).rowCount
    )
      v.fail(404, "Category not found.");
  });
  res.status(204).send();
}
async function saveMaster(req, res) {
  const b = req.body || {},
    id = req.params.masterId ? v.id(req.params.masterId) : null;
  const values = [
    v.string(b.name, "Product name", 200, true),
    v.string(b.manufacturer, "Manufacturer", 200, true),
    v.url(b.images),
    v.string(b.description, "Description", 20000),
    v.id(b.category_id, "Category"),
    v.money(b.wholesale_price),
  ];
  const status = b.active_status ?? "available";
  if (!["available", "discontinued"].includes(status))
    v.fail(400, "Choose a valid product status.");
  if (!Array.isArray(b.attributes) || b.attributes.length > 100)
    v.fail(400, "Existing attributes must be an array of at most 100 entries.");
  const additionalBody = b.additional_attributes ?? [];
  if (!Array.isArray(additionalBody) || additionalBody.length > 100)
    v.fail(400, "Additional attributes must be an array of at most 100 entries.");
  const attributes = b.attributes.map((a) => [
    v.id(a?.attribute_id, "Attribute"),
    v.string(a?.attrib_value, "Attribute value", 500, true),
  ]);
  if (new Set(attributes.map((a) => a[0])).size !== attributes.length)
    v.fail(400, "Each attribute may have only one value.");
  const additional = additionalBody.map((a) => [
    v.string(a?.name, "Additional attribute name", 100, true),
    v.string(a?.value, "Additional attribute value", 500, true),
  ]);
  const master = await transaction(async (c) => {
    const result = id
      ? await c.query(
        q.UPDATE_MASTER,
          [...values, status, id],
        )
      : await c.query(
        q.CREATE_MASTER,
          [...values, status],
        );
    if (!result.rowCount) v.fail(404, "Master product not found.");
    const master = result.rows[0];
    await c.query(q.DELETE_MASTER_VALUES, [
      master.master_prod_id,
    ]);
    for (const [attribute, value] of attributes)
      await c.query(
        q.CREATE_MASTER_VALUE,
        [master.master_prod_id, attribute, value],
      );
    for (const [name, value] of additional) {
      const attribute = (await c.query(q.CREATE_ATTRIBUTE, [name, ""]))
        .rows[0];
      await c.query(q.CREATE_MASTER_VALUE, [
        master.master_prod_id,
        attribute.attribute_id,
        value,
      ]);
    }
    await c.query(
      q.SYNC_MASTER_LISTINGS,
      [master.name, master.images, master.master_prod_id],
    );
    return master;
  });
  res.status(id ? 200 : 201).json({ message: "Master product saved.", master });
}
// Pay a vendor for the stock they still hold of one listing.
//
// Both removal paths go through here — removing a listing, and removing a master
// product with all its listings — so the LIFO rule and the earnings credit
// cannot drift apart between the two.
//
// The caller must already have claimed the listing (the guarded UPDATE in
// DISCONTINUE_LISTING, or the FOR UPDATE in MASTER_LISTINGS_WITH_STOCK). That
// matters for more than tidiness: it holds the row lock, so in_stock cannot move
// between this reading it and PAID_OUT_LISTING zeroing it.
async function refundListing(c, listing, adminId, reason) {
  const attribution = (await c.query(q.REFUND_ATTRIBUTION, [[listing.prod_id]]))
    .rows[0];
  if (!attribution)
    v.fail(409, "That listing disappeared before it could be refunded.");
  const refund = (
    await c.query(q.CREATE_VENDOR_REFUND, [
      listing.shop_id,
      listing.prod_id,
      listing.master_prod_id,
      attribution.units,
      attribution.amount,
      reason,
      adminId,
    ])
  ).rows[0];
  // A listing can legitimately be out of stock, which refunds nothing and is not
  // an error — the removal still happened and the ledger row records it.
  if (attribution.units > 0)
    await c.query(q.CREDIT_SHOP_EARNINGS, [
      listing.shop_id,
      attribution.amount,
    ]);
  return refund;
}

async function removeListing(req, res) {
  const prodId = v.id(req.params.prodId);
  const refund = await transaction(async (c) => {
    const listing = (await c.query(q.DISCONTINUE_LISTING, [prodId])).rows[0];
    if (!listing) {
      // Two different refusals, and the difference is the whole point: an
      // unknown id is a 404, and an already-removed listing is a 409 that pays
      // nothing. Without this the second click would refund the vendor again.
      if (!(await c.query(q.LISTING_BY_ID, [prodId])).rowCount)
        v.fail(404, "Listing not found.");
      v.fail(409, "That listing has already been removed.");
    }
    const paid = await refundListing(
      c,
      listing,
      req.user.user_id,
      "admin_removal",
    );
    await c.query(q.PAID_OUT_LISTING, [[prodId]]);
    return paid;
  });
  res.json({
    message:
      refund.units > 0
        ? `Listing removed. $${Number(refund.amount).toFixed(2)} refunded to the vendor.`
        : "Listing removed. It held no stock, so there was nothing to refund.",
    refund,
  });
}

async function listShopListings(req, res) {
  const shopId = v.id(req.params.shopId);
  const listings = (await pool.query(q.LIST_SHOP_LISTINGS, [shopId])).rows;
  if (!listings.length) return res.json([]);
  const attribution = (
    await pool.query(q.REFUND_ATTRIBUTION, [
      listings.map((listing) => listing.prod_id),
    ])
  ).rows;
  const refundByListing = new Map(
    attribution.map((row) => [row.prod_id, row]),
  );
  res.json(
    listings.map((listing) => ({
      ...listing,
      refund: refundByListing.get(listing.prod_id) ?? null,
    })),
  );
}

async function deleteMaster(req, res) {
  const masterId = v.id(req.params.masterId);
  const result = await transaction(async (c) => {
    if (!(await c.query(q.DISCONTINUE_MASTER, [masterId])).rowCount)
      v.fail(404, "Master product not found.");
    // Only listings that still hold stock need compensating, and in_stock rather
    // than discontinued decides that. A listing the vendor retired themselves
    // has already been discontinued and was never paid for its stock; the master
    // going away strands that stock just the same, so it is refunded here too.
    // Re-running the removal finds nothing left to pay, which is what makes this
    // safe to call twice.
    const withStock = (
      await c.query(q.MASTER_LISTINGS_WITH_STOCK, [masterId])
    ).rows;
    const refunds = [];
    for (const listing of withStock)
      refunds.push(
        await refundListing(c, listing, req.user.user_id, "admin_removal"),
      );
    // After the attributions, never before: it zeroes the in_stock they read.
    await c.query(q.REMOVE_MASTER_LISTINGS, [masterId]);
    return refunds;
  });
  const total = result.reduce((sum, refund) => sum + Number(refund.amount), 0);
  res.json({
    message:
      result.length > 0
        ? `Master product discontinued. $${total.toFixed(2)} refunded across ${result.length} listing${result.length === 1 ? "" : "s"}. Purchase history is preserved.`
        : "Master product discontinued. No remaining stock was held, so there was nothing to refund. Purchase history is preserved.",
    refunds: result,
    total,
  });
}

module.exports = {
  listMasters,
  availableMasters,
  metadata,
  createAttribute,
  saveCategory,
  deleteCategory,
  saveMaster,
  deleteMaster,
  removeListing,
  listShopListings,
};
