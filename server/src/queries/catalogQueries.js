const LIST_ROLES = `
    SELECT role_id, role_name, description
    FROM roles
    ORDER BY role_id
`;

const LIST_PRODUCTS = `
    SELECT p.prod_id, p.name, p.images, p.description, p.in_stock, p.unit_price,
           s.shop_id, s.name AS shop_name,
           mp.master_prod_id, mp.manufacturer, c.name AS category_name
    FROM products p
    JOIN shops s ON p.shop_id = s.shop_id
    JOIN master_products mp ON p.master_prod_id = mp.master_prod_id
    JOIN categories c ON c.category_id = mp.category_id
    WHERE p.discontinued = false
      AND s.active_status = 'active'
      AND mp.active_status = 'available'
    ORDER BY p.prod_id
`;

const GET_PRODUCT_BY_ID = `
    SELECT p.prod_id, p.name, p.images, p.description, p.in_stock, p.unit_price,
           s.shop_id, s.name AS shop_name,
           mp.master_prod_id, mp.manufacturer, c.name AS category_name, mp.description AS master_description,
           COALESCE((SELECT json_agg(json_build_object('name',a.name,'attrib_value',av.attrib_value) ORDER BY a.name)
           FROM attribute_values av JOIN attributes a USING(attribute_id) WHERE av.master_prod_id=mp.master_prod_id),'[]'::json) AS attributes
    FROM products p
    JOIN shops s ON p.shop_id = s.shop_id
    JOIN master_products mp ON p.master_prod_id = mp.master_prod_id
    JOIN categories c ON c.category_id = mp.category_id
    WHERE p.prod_id = $1
      AND p.discontinued = false
      AND s.active_status = 'active'
      AND mp.active_status = 'available'
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

const LIST_USERS = `
    SELECT u.user_id, u.name, u.email, u.active_status, r.role_name
    FROM users u
    LEFT JOIN roles r ON u.user_role = r.role_id
    ORDER BY u.user_id
`;

module.exports = {
  GET_PRODUCT_BY_ID,
  LIST_CATEGORIES,
  LIST_PRODUCTS,
  LIST_ROLES,
  LIST_SHOPS,
  LIST_USERS,
};
