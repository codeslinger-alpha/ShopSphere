const MASTER_SELECT = `
  SELECT mp.*, c.name AS category_name
  FROM master_products mp
  JOIN categories c USING (category_id)
`;

const LIST_MASTERS = `${MASTER_SELECT} ORDER BY mp.master_prod_id`;
const LIST_AVAILABLE_MASTERS = `
  ${MASTER_SELECT}
  WHERE mp.active_status = 'available'
  ORDER BY mp.name
`;
const LIST_MASTER_ATTRIBUTES = `
  SELECT
    av.master_prod_id,
    a.attribute_id,
    a.name,
    a.description,
    av.attrib_value,
    ca.attribute_id IS NOT NULL AS required
  FROM attribute_values av
  JOIN master_products mp ON mp.master_prod_id = av.master_prod_id
  JOIN attributes a ON a.attribute_id = av.attribute_id
  LEFT JOIN category_attributes ca
    ON ca.category_id = mp.category_id
   AND ca.attribute_id = av.attribute_id
  ORDER BY av.master_prod_id, a.name
`;

const LIST_CATALOG_CATEGORIES = `SELECT * FROM categories ORDER BY name`;
const LIST_CATEGORY_ATTRIBUTES = `
  SELECT category_id, attribute_id
  FROM category_attributes
  ORDER BY category_id, attribute_id
`;
const LIST_ATTRIBUTES = `SELECT * FROM attributes ORDER BY name`;

const CREATE_ATTRIBUTE = `
  INSERT INTO attributes (name, description)
  VALUES ($1, $2)
  RETURNING *
`;
const CATEGORY_EXISTS = `SELECT 1 FROM categories WHERE category_id = $1`;
const CATEGORY_PARENT_CYCLE = `
  WITH RECURSIVE descendants AS (
    SELECT category_id FROM categories WHERE category_id = $1
    UNION
    SELECT c.category_id
    FROM categories c
    JOIN descendants d ON c.parent_category = d.category_id
  )
  SELECT 1 FROM descendants WHERE category_id = $2
`;
const UPDATE_CATEGORY = `
  UPDATE categories
  SET name = $1, description = $2, parent_category = $3
  WHERE category_id = $4
  RETURNING *
`;
const CREATE_CATEGORY = `
  INSERT INTO categories (name, description, parent_category)
  VALUES ($1, $2, $3)
  RETURNING *
`;
const DELETE_CATEGORY_ATTRIBUTES = `
  DELETE FROM category_attributes WHERE category_id = $1
`;
const CREATE_CATEGORY_ATTRIBUTE = `
  INSERT INTO category_attributes (category_id, attribute_id)
  VALUES ($1, $2)
`;
const BACKFILL_CATEGORY_ATTRIBUTE = `
  INSERT INTO attribute_values (master_prod_id, attribute_id, attrib_value)
  SELECT master_prod_id, $2, $3
  FROM master_products
  WHERE category_id = $1
  ON CONFLICT (master_prod_id, attribute_id) DO NOTHING
`;
const CATEGORY_HAS_DEPENDENTS = `
  SELECT 1 FROM categories WHERE parent_category = $1
  UNION ALL
  SELECT 1 FROM master_products WHERE category_id = $1
`;
const DELETE_CATEGORY = `
  DELETE FROM categories WHERE category_id = $1 RETURNING category_id
`;

const UPDATE_MASTER = `
  UPDATE master_products
  SET name = $1, manufacturer = $2, images = $3, description = $4,
      category_id = $5, wholesale_price = $6, active_status = $7
  WHERE master_prod_id = $8
  RETURNING *
`;
const CREATE_MASTER = `
  INSERT INTO master_products (
    name, manufacturer, images, description, category_id, wholesale_price, active_status
  ) VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *
`;
const DELETE_MASTER_VALUES = `
  DELETE FROM attribute_values WHERE master_prod_id = $1
`;
const CREATE_MASTER_VALUE = `
  INSERT INTO attribute_values (master_prod_id, attribute_id, attrib_value)
  VALUES ($1, $2, $3)
`;
const SYNC_MASTER_LISTINGS = `
  UPDATE products SET name = $1, images = $2 WHERE master_prod_id = $3
`;
const DISCONTINUE_MASTER = `
  UPDATE master_products
  SET active_status = 'discontinued'
  WHERE master_prod_id = $1
  RETURNING master_prod_id
`;
const LOCK_CATALOG = `SELECT pg_advisory_xact_lock(216, 602)`;

module.exports = {
  BACKFILL_CATEGORY_ATTRIBUTE,
  CATEGORY_EXISTS,
  CATEGORY_HAS_DEPENDENTS,
  CATEGORY_PARENT_CYCLE,
  CREATE_ATTRIBUTE,
  CREATE_CATEGORY,
  CREATE_CATEGORY_ATTRIBUTE,
  CREATE_MASTER,
  CREATE_MASTER_VALUE,
  DELETE_CATEGORY,
  DELETE_CATEGORY_ATTRIBUTES,
  DELETE_MASTER_VALUES,
  DISCONTINUE_MASTER,
  LIST_ATTRIBUTES,
  LIST_AVAILABLE_MASTERS,
  LIST_CATEGORY_ATTRIBUTES,
  LIST_CATALOG_CATEGORIES,
  LIST_MASTER_ATTRIBUTES,
  LIST_MASTERS,
  LOCK_CATALOG,
  SYNC_MASTER_LISTINGS,
  UPDATE_CATEGORY,
  UPDATE_MASTER,
};
