const pool = require("../config/db");
const transaction = require("../utils/transaction");
const v = require("../utils/input");
const q = require("../queries/adminCatalogQueries");
async function listMasters(req, res) {
  res.json(
    (await pool.query(q.LIST_MASTERS)).rows,
  );
}
async function availableMasters(req, res) {
  res.json(
    (
      await pool.query(q.LIST_AVAILABLE_MASTERS)
    ).rows,
  );
}
async function metadata(req, res) {
  const [categories, attributes] = await Promise.all([
    pool.query(q.LIST_CATALOG_CATEGORIES),
    pool.query(q.LIST_ATTRIBUTES),
  ]);
  res.json({ categories: categories.rows, attributes: attributes.rows });
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
    await c.query(q.LOCK_CATALOG);
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
    await c.query(q.LOCK_CATALOG);
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
    v.fail(400, "Attributes must be an array of at most 100 entries.");
  const attributes = b.attributes.map((a) => [
    v.id(a?.attribute_id, "Attribute"),
    v.string(a?.attrib_value, "Attribute value", 500, true),
  ]);
  if (new Set(attributes.map((a) => a[0])).size !== attributes.length)
    v.fail(400, "Each attribute may have only one value.");
  const master = await transaction(async (c) => {
    await c.query(q.LOCK_CATALOG);
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
    // Listing identity and images always follow the master; seller descriptions stay independent.
    await c.query(
      q.SYNC_MASTER_LISTINGS,
      [master.name, master.images, master.master_prod_id],
    );
    return master;
  });
  res.status(id ? 200 : 201).json({ message: "Master product saved.", master });
}
async function deleteMaster(req, res) {
  const result = await pool.query(
    q.DISCONTINUE_MASTER,
    [v.id(req.params.masterId)],
  );
  if (!result.rowCount) v.fail(404, "Master product not found.");
  res.json({
    message: "Master product discontinued. Purchase history is preserved.",
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
};
