const pool = require("../db/pool");
const {
  CHECK_DATABASE_CONNECTION,
  GET_PRODUCT_BY_ID,
  GET_MASTER_ATTRIBUTE_VALUES,
  LIST_CATEGORIES,
  LIST_ROLES,
  LIST_SHOPS,
  buildProductFacetsQuery,
  buildProductListQuery,
} = require("../db/queries/catalogQueries");
const { paginated } = require("../utils/listQuery");

const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SORT_ORDERS,
  parseAttributeFilters,
  parsePage,
  parsePageSize,
  parsePositiveInteger,
  parsePrice,
  parseSearchTerm,
  parseSort,
} = require("../utils/validation");

// Turns the catalog query string into the filter object the query builders
// expect. Returns { filters } on success or { error } with a shopper-readable
// message. Absent parameters fall back to browsing the whole available catalog.
function parseProductQuery(query = {}) {
  const filters = {
    q: "",
    categoryId: null,
    minPrice: null,
    maxPrice: null,
    attributes: new Map(),
    sort: SORT_ORDERS[0],
    page: 1,
    limit: DEFAULT_PAGE_SIZE,
  };

  if (query.q !== undefined && query.q !== "") {
    const term = parseSearchTerm(query.q);
    if (term === null)
      return { error: "A search term can be up to 200 characters." };
    filters.q = term;
  }

  if (query.category_id !== undefined && query.category_id !== "") {
    const categoryId = parsePositiveInteger(query.category_id);
    if (!categoryId)
      return { error: "Category ID must be a positive integer." };
    filters.categoryId = categoryId;
  }

  for (const [parameter, field] of [
    ["min_price", "minPrice"],
    ["max_price", "maxPrice"],
  ]) {
    if (query[parameter] === undefined || query[parameter] === "") continue;
    const price = parsePrice(query[parameter]);
    if (price === null)
      return {
        error: "Prices must be positive numbers with up to two decimals.",
      };
    filters[field] = price;
  }
  if (
    filters.minPrice !== null &&
    filters.maxPrice !== null &&
    filters.minPrice > filters.maxPrice
  )
    return { error: "The minimum price cannot exceed the maximum price." };

  if (query.sort !== undefined && query.sort !== "") {
    const sort = parseSort(query.sort);
    if (sort === null)
      return { error: `Sort must be one of: ${SORT_ORDERS.join(", ")}.` };
    filters.sort = sort;
  }

  if (query.page !== undefined && query.page !== "") {
    const page = parsePage(query.page);
    if (page === null) return { error: "Page must be a positive integer." };
    filters.page = page;
  }

  if (query.limit !== undefined && query.limit !== "") {
    const limit = parsePageSize(query.limit);
    if (limit === null)
      return { error: `Limit must be a positive integer up to ${MAX_PAGE_SIZE}.` };
    filters.limit = limit;
  }

  const attributes = parseAttributeFilters(query.attribute);
  if (attributes === null)
    return {
      error: "Attribute filters must use the form attribute_id:value.",
    };
  filters.attributes = attributes;

  return { filters };
}

async function listRoles(req, res) {
  const result = await pool.query(LIST_ROLES);
  return res.json(result.rows);
}

async function listProducts(req, res) {
  const parsed = parseProductQuery(req.query);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const filters = parsed.filters;
  const { text, values } = buildProductListQuery(filters);
  const result = await pool.query(text, values);

  return res.json(paginated(result.rows, filters.page, filters.limit));
}

// Checkbox values for the catalog filter panel, grouped by the client on
// attribute_id. Category is optional: without it, the whole catalog is scoped.
async function listProductFacets(req, res) {
  const parsed = parseProductQuery(req.query);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const { text, values } = buildProductFacetsQuery(parsed.filters);
  const result = await pool.query(text, values);
  return res.json(result.rows);
}

async function getProduct(req, res) {
  const productId = parsePositiveInteger(req.params.productId);

  if (!productId) {
    return res
      .status(400)
      .json({ message: "Product ID must be a positive integer." });
  }

  const result = await pool.query(GET_PRODUCT_BY_ID, [productId]);

  if (result.rows.length === 0) {
    return res.status(404).json({ message: "Product not found." });
  }

  const product = result.rows[0];
  const attributes = await pool.query(GET_MASTER_ATTRIBUTE_VALUES, [
    product.master_prod_id,
  ]);
  return res.json({ ...product, attributes: attributes.rows });
}

async function listCategories(req, res) {
  const result = await pool.query(LIST_CATEGORIES);
  return res.json(result.rows);
}

async function listShops(req, res) {
  const result = await pool.query(LIST_SHOPS);
  return res.json(result.rows);
}

async function healthCheck(req, res) {
  try {
    const result = await pool.query(CHECK_DATABASE_CONNECTION);
    return res.json({
      success: true,
      database: result.rows[0].database_connected === 1,
    });
  } catch {
    return res
      .status(503)
      .json({ success: false, message: "Database is unavailable." });
  }
}

module.exports = {
  getProduct,
  healthCheck,
  listCategories,
  listProductFacets,
  listProducts,
  listRoles,
  listShops,
};
