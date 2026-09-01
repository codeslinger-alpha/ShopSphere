-- Sample data for categories and master_products
-- Run this after schema.sql.
--
-- master_products.category_id is resolved by category name, so this file
-- does not depend on hard-coded identity values.

BEGIN;

-- =========================================================
-- CATEGORIES
-- =========================================================

-- Top-level categories
INSERT INTO categories (name, description)
SELECT v.name, v.description
FROM (
    VALUES
        ('Electronics', 'Electronic devices and accessories'),
        ('Computers', 'Computers, laptops, and computer hardware'),
        ('Mobile Phones', 'Smartphones and mobile phone accessories'),
        ('Home Appliances', 'Appliances and electrical equipment for the home'),
        ('Fashion', 'Clothing, footwear, and fashion accessories'),
        ('Groceries', 'Food, beverages, and everyday grocery items'),
        ('Beauty', 'Beauty, personal care, and grooming products'),
        ('Sports', 'Sports equipment and fitness products')
) AS v(name, description)
WHERE NOT EXISTS (
    SELECT 1
    FROM categories c
    WHERE c.name = v.name
      AND c.parent_category IS NULL
);

-- Subcategories
INSERT INTO categories (name, description, parent_category)
SELECT v.name, v.description, p.category_id
FROM (
    VALUES
        ('Laptops', 'Laptop computers'),
        ('Desktop Computers', 'Desktop PCs and workstations'),
        ('Computer Components', 'PC components and hardware'),
        ('Computer Accessories', 'Keyboards, mice, webcams, and other accessories'),
        ('Smartphones', 'Smartphones and mobile devices'),
        ('Phone Accessories', 'Cases, chargers, cables, and other phone accessories'),
        ('Kitchen Appliances', 'Appliances used in the kitchen'),
        ('Home Electronics', 'Electronic products for the home'),
        ('Men''s Clothing', 'Clothing for men'),
        ('Women''s Clothing', 'Clothing for women'),
        ('Footwear', 'Shoes and other footwear'),
        ('Beverages', 'Drinks and beverages'),
        ('Snacks', 'Packaged snacks and light foods'),
        ('Personal Care', 'Personal hygiene and care products'),
        ('Skin Care', 'Skin care products'),
        ('Fitness Equipment', 'Equipment for exercise and fitness')
) AS v(name, description)
JOIN categories p
    ON p.name = CASE
        WHEN v.name IN ('Laptops', 'Desktop Computers',
                        'Computer Components', 'Computer Accessories')
            THEN 'Computers'
        WHEN v.name IN ('Smartphones', 'Phone Accessories')
            THEN 'Mobile Phones'
        WHEN v.name IN ('Kitchen Appliances', 'Home Electronics')
            THEN 'Home Appliances'
        WHEN v.name IN ('Men''s Clothing', 'Women''s Clothing', 'Footwear')
            THEN 'Fashion'
        WHEN v.name IN ('Beverages', 'Snacks')
            THEN 'Groceries'
        WHEN v.name IN ('Personal Care', 'Skin Care')
            THEN 'Beauty'
        WHEN v.name IN ('Fitness Equipment')
            THEN 'Sports'
    END
    AND p.parent_category IS NULL
WHERE NOT EXISTS (
    SELECT 1
    FROM categories c
    WHERE c.name = v.name
      AND c.parent_category = p.category_id
);

-- =========================================================
-- MASTER PRODUCTS
-- =========================================================
-- These are product definitions/manufacturer products.
-- A shop-specific listing belongs in the products table later.

INSERT INTO master_products
    (manufacturer, images, description, category_id, wholesale_price, name)
SELECT
    v.manufacturer,
    v.images,
    v.description,
    c.category_id,
    v.wholesale_price,
    v.name
FROM (
    VALUES
        (
            'Dell',
            ARRAY['dell-inspiron-15.jpg'],
            '15-inch laptop suitable for study, office work, and everyday computing.',
            'Laptops',
            550.00::DECIMAL,
            'Dell Inspiron 15'
        ),
        (
            'Lenovo',
            ARRAY['lenovo-ideapad-3.jpg'],
            'Affordable laptop designed for students and everyday productivity.',
            'Laptops',
            420.00::DECIMAL,
            'Lenovo IdeaPad 3'
        ),
        (
            'ASUS',
            ARRAY['asus-tuf-a15.jpg'],
            'Gaming laptop with a dedicated graphics processor.',
            'Laptops',
            850.00::DECIMAL,
            'ASUS TUF Gaming A15'
        ),
        (
            'Apple',
            ARRAY['macbook-air-m3.jpg'],
            'Thin and lightweight laptop powered by Apple silicon.',
            'Laptops',
            850.00::DECIMAL,
            'MacBook Air'
        ),
        (
            'Intel',
            ARRAY['intel-core-i5.jpg'],
            'Desktop processor for general-purpose computing.',
            'Computer Components',
            160.00::DECIMAL,
            'Intel Core i5 Processor'
        ),
        (
            'AMD',
            ARRAY['amd-ryzen-5.jpg'],
            'Multi-core desktop processor for productivity and gaming.',
            'Computer Components',
            140.00::DECIMAL,
            'AMD Ryzen 5 Processor'
        ),
        (
            'Logitech',
            ARRAY['logitech-mx-master-3s.jpg'],
            'Wireless ergonomic computer mouse.',
            'Computer Accessories',
            55.00::DECIMAL,
            'Logitech MX Master 3S'
        ),
        (
            'Logitech',
            ARRAY['logitech-k380.jpg'],
            'Compact wireless keyboard suitable for desktop and mobile use.',
            'Computer Accessories',
            28.00::DECIMAL,
            'Logitech K380 Keyboard'
        ),
        (
            'Samsung',
            ARRAY['samsung-galaxy-s25.jpg'],
            'Modern Android smartphone with a high-resolution display.',
            'Smartphones',
            650.00::DECIMAL,
            'Samsung Galaxy S25'
        ),
        (
            'Apple',
            ARRAY['iphone-16.jpg'],
            'Apple smartphone with advanced camera and performance features.',
            'Smartphones',
            720.00::DECIMAL,
            'iPhone 16'
        ),
        (
            'Xiaomi',
            ARRAY['xiaomi-redmi-note.jpg'],
            'Affordable smartphone with a large display and long battery life.',
            'Smartphones',
            180.00::DECIMAL,
            'Xiaomi Redmi Note'
        ),
        (
            'Anker',
            ARRAY['anker-charger.jpg'],
            'USB-C fast charger for smartphones and other compatible devices.',
            'Phone Accessories',
            15.00::DECIMAL,
            'Anker USB-C Charger'
        ),
        (
            'Anker',
            ARRAY['anker-power-bank.jpg'],
            'Portable rechargeable power bank.',
            'Phone Accessories',
            22.00::DECIMAL,
            'Anker Power Bank'
        ),
        (
            'Philips',
            ARRAY['philips-air-fryer.jpg'],
            'Compact air fryer for convenient home cooking.',
            'Kitchen Appliances',
            65.00::DECIMAL,
            'Philips Air Fryer'
        ),
        (
            'Samsung',
            ARRAY['samsung-microwave.jpg'],
            'Countertop microwave oven for everyday cooking.',
            'Kitchen Appliances',
            90.00::DECIMAL,
            'Samsung Microwave Oven'
        ),
        (
            'Nike',
            ARRAY['nike-running-shoes.jpg'],
            'Lightweight running shoes for everyday training.',
            'Footwear',
            55.00::DECIMAL,
            'Nike Running Shoes'
        ),
        (
            'Adidas',
            ARRAY['adidas-tshirt.jpg'],
            'Comfortable sports T-shirt for training and casual use.',
            'Men''s Clothing',
            18.00::DECIMAL,
            'Adidas Sports T-Shirt'
        ),
        (
            'Coca-Cola',
            ARRAY['coca-cola.jpg'],
            'Carbonated soft drink.',
            'Beverages',
            0.50::DECIMAL,
            'Coca-Cola'
        ),
        (
            'Nestle',
            ARRAY['nestle-chocolate.jpg'],
            'Milk chocolate snack.',
            'Snacks',
            1.00::DECIMAL,
            'Nestle Chocolate'
        ),
        (
            'Nivea',
            ARRAY['nivea-body-lotion.jpg'],
            'Moisturizing body lotion for everyday skin care.',
            'Skin Care',
            4.00::DECIMAL,
            'Nivea Body Lotion'
        ),
        (
            'Philips',
            ARRAY['philips-trimmer.jpg'],
            'Rechargeable electric trimmer for personal grooming.',
            'Personal Care',
            18.00::DECIMAL,
            'Philips Trimmer'
        ),
        (
            'Decathlon',
            ARRAY['decathlon-yoga-mat.jpg'],
            'Non-slip exercise mat for yoga and floor exercises.',
            'Fitness Equipment',
            12.00::DECIMAL,
            'Yoga Mat'
        )
) AS v(
    manufacturer,
    images,
    description,
    category_name,
    wholesale_price,
    name
)
JOIN categories c
    ON c.name = v.category_name
WHERE NOT EXISTS (
    SELECT 1
    FROM master_products mp
    WHERE mp.name = v.name
      AND mp.manufacturer = v.manufacturer
);

COMMIT;

-- =========================================================
-- VERIFY
-- =========================================================

SELECT
    mp.master_prod_id,
    mp.name,
    mp.manufacturer,
    c.name AS category,
    mp.wholesale_price,
    mp.active_status
FROM master_products mp
JOIN categories c
    ON c.category_id = mp.category_id
ORDER BY mp.master_prod_id;
