// Oracle needs a FROM clause on every SELECT.
const CHECK_DATABASE_CONNECTION = "SELECT 1 AS database_connected FROM dual";

const { escapeLikePattern } = require("../sql");

const LIST_ROLES = `
    SELECT role_id, role_name, description
    FROM roles
    ORDER BY role_id
`;

const PRODUCT_COLUMNS = `
    p.prod_id, p.name, p.images, p.description, p.in_stock, p.unit_price,
    p.created_at,
    s.shop_id, s.name AS shop_name,
    mp.master_prod_id, mp.manufacturer,
    c.category_id, c.name AS category_name
`;

// Available listings only: the storefront must never show discontinued items,
// disabled shops or discontinued masters.
const BASE_CONDITIONS = [
  "p.discontinued = 0",
  "s.active_status = 'active'",
  "mp.active_status = 'available'",
];

// Descriptions are CLOB here, and Oracle will not compare a LOB with LIKE.
// DBMS_LOB.SUBSTR takes the first 4000 characters of it, which is as much of a
// description as a search looks at — and is the same ceiling Oracle puts on a
// VARCHAR2, so nothing that could have been compared is being skipped.
const descriptionText = (column) => `DBMS_LOB.SUBSTR(${column}, 4000, 1)`;

// The sort key is chosen from this whitelist, never interpolated from input.
// Every clause tie-breaks on p.prod_id so paging stays stable across pages.
const SORT_CLAUSES = {
  relevance: "p.prod_id DESC",
  newest: "p.created_at DESC, p.prod_id DESC",
  price_asc: "p.unit_price ASC, p.prod_id ASC",
  price_desc: "p.unit_price DESC, p.prod_id DESC",
  name: "p.name ASC, p.prod_id ASC",
};

// Builds the category scope and the WHERE conditions for both the listing and
// the facet query, so the grid and its counts can never disagree about what
// "matching" means. Parameters are pushed in the order they appear in the
// final statement: the recursive CTE is emitted before the WHERE clause, so its
// parameter must be pushed first.
//
// Three spellings are Oracle's. WITH RECURSIVE is WITH — this database's
// recursive subquery factoring does not announce itself. ILIKE is LOWER(x) LIKE
// LOWER(:n). And a list of attribute values is `IN (:n)`, which is the form
// src/db/execute.js expands an array bind into.
function buildScope(filters, values, { includeAttributes }) {
  const conditions = [...BASE_CONDITIONS];

  let cte = "";
  if (filters.categoryId) {
    values.push(filters.categoryId);
    // Selecting a parent category includes every descendant, at any depth.
    cte = `WITH category_scope (category_id) AS (
      SELECT category_id FROM categories WHERE category_id = :${values.length}
      UNION ALL
      SELECT child.category_id FROM categories child
      JOIN category_scope parent ON child.parent_category = parent.category_id
    )`;
    conditions.push("mp.category_id IN (SELECT category_id FROM category_scope)");
  }

  if (filters.q) {
    values.push(`%${escapeLikePattern(filters.q)}%`);
    const term = `:${values.length}`;
    conditions.push(`(LOWER(p.name) LIKE LOWER(${term}) ESCAPE '\\'
        OR LOWER(mp.name) LIKE LOWER(${term}) ESCAPE '\\'
        OR LOWER(mp.manufacturer) LIKE LOWER(${term}) ESCAPE '\\'
        OR LOWER(${descriptionText("mp.description")}) LIKE LOWER(${term}) ESCAPE '\\'
        OR LOWER(c.name) LIKE LOWER(${term}) ESCAPE '\\')`);
  }

  if (filters.minPrice !== null) {
    values.push(filters.minPrice);
    conditions.push(`p.unit_price >= :${values.length}`);
  }

  if (filters.maxPrice !== null) {
    values.push(filters.maxPrice);
    conditions.push(`p.unit_price <= :${values.length}`);
  }

  if (includeAttributes) {
    // One EXISTS per attribute: values inside an attribute OR together, and
    // separate attributes AND together.
    for (const [attributeId, attributeValues] of filters.attributes) {
      values.push(attributeId, attributeValues);
      conditions.push(`EXISTS (
        SELECT 1 FROM attribute_values av
        WHERE av.master_prod_id = mp.master_prod_id
          AND av.attribute_id = :${values.length - 1}
          AND av.attrib_value IN (:${values.length})
      )`);
    }
  }

  return { cte, conditions };
}

function buildProductListQuery(filters) {
  const values = [];
  const { cte, conditions } = buildScope(filters, values, {
    includeAttributes: true,
  });

  values.push(filters.limit, (filters.page - 1) * filters.limit);
  const text = `${cte}
    SELECT ${PRODUCT_COLUMNS}, COUNT(*) OVER() AS total_count
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    JOIN categories c ON c.category_id = mp.category_id
    WHERE ${conditions.join("\n      AND ")}
    ORDER BY ${SORT_CLAUSES[filters.sort]}
    OFFSET :${values.length} ROWS FETCH NEXT :${values.length - 1} ROWS ONLY`;

  return { text, values };
}

// Attribute values are stored per master product, so a facet describes the
// master rather than the individual shop listing. Counts honor the search,
// category and price filters but ignore the attribute checkboxes themselves, so
// a value's count does not collapse to the current selection when it is ticked.
function buildProductFacetsQuery(filters) {
  const values = [];
  const { cte, conditions } = buildScope(filters, values, {
    includeAttributes: false,
  });

  const text = `${cte}
    SELECT a.attribute_id, a.name AS attribute_name,
           av.attrib_value AS value,
           COUNT(DISTINCT p.prod_id) AS listing_count
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    JOIN categories c ON c.category_id = mp.category_id
    JOIN category_attributes ca ON ca.category_id = mp.category_id
    JOIN attributes a ON a.attribute_id = ca.attribute_id
    JOIN attribute_values av ON av.master_prod_id = mp.master_prod_id
                            AND av.attribute_id = ca.attribute_id
    WHERE ${conditions.join("\n      AND ")}
    GROUP BY a.attribute_id, a.name, av.attrib_value
    ORDER BY a.name, av.attrib_value`;

  return { text, values };
}

const GET_PRODUCT_BY_ID = `
    SELECT p.prod_id, p.name, p.images, p.description, p.in_stock, p.unit_price,
           s.shop_id, s.name AS shop_name,
           mp.master_prod_id, mp.manufacturer, c.name AS category_name,
           mp.description AS master_description
    FROM products p
    JOIN shops s ON p.shop_id = s.shop_id
    JOIN master_products mp ON p.master_prod_id = mp.master_prod_id
    JOIN categories c ON c.category_id = mp.category_id
    WHERE p.prod_id = :1
      AND p.discontinued = 0
      AND s.active_status = 'active'
      AND mp.active_status = 'available'
`;

const GET_MASTER_ATTRIBUTE_VALUES = `
    SELECT a.name, av.attrib_value
    FROM attribute_values av
    JOIN attributes a ON a.attribute_id = av.attribute_id
    WHERE av.master_prod_id = :1
    ORDER BY a.name
`;

const LIST_CATEGORIES = `
    SELECT category_id, name, description, parent_category
    FROM categories
    ORDER BY name
`;

const LIST_SHOPS = `
    SELECT shop_id, name, logo, description, phone_numbers
    FROM shops
    WHERE active_status = 'active'
    ORDER BY name
`;

module.exports = {
  CHECK_DATABASE_CONNECTION,
  GET_PRODUCT_BY_ID,
  GET_MASTER_ATTRIBUTE_VALUES,
  LIST_CATEGORIES,
  LIST_ROLES,
  LIST_SHOPS,
  buildProductFacetsQuery,
  buildProductListQuery,
};
