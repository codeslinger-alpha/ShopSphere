-- LOCAL DEMO ACCOUNTS ONLY. Do not use these credentials in production.
-- Run after roles.sql. Each password is already bcrypt-hashed with 12 rounds.
-- customer@shopsphere.test / CustomerPass123!
-- vendor@shopsphere.test   / VendorPass123!
-- delivery@shopsphere.test / DeliveryPass123!
-- admin@shopsphere.test    / AdminPass123!

INSERT INTO users (user_role, name, password_hash, email)
SELECT r.role_id, v.name, v.password_hash, v.email
FROM (
    VALUES
        ('customer', 'Demo Customer', '$2b$12$0FsSWCFEJmzpYgpeDsJM8.jZUrx23lA6NS2GqlY45PN7qMYZosMXu', 'customer@shopsphere.test'),
        ('vendor', 'Demo Vendor', '$2b$12$kl8MER9AlKkJds8vf5vd1O63gKUSMRmLp2HS4L8EbY3n7gZnD6gwS', 'vendor@shopsphere.test'),
        ('delivery', 'Demo Delivery', '$2b$12$YGw9lBHq6E7pThCFvDHCN.gNkXG2NpQCgsMjzaAAv2uEe7GE2f32q', 'delivery@shopsphere.test'),
        ('admin', 'Demo Admin', '$2b$12$YphciKYSXIqqLaGDGQt1ZuUzK6WPcwG72brCR2.gyJzgZGUgJrbKa', 'admin@shopsphere.test')
) AS v(role_name, name, password_hash, email)
JOIN roles r ON r.role_name = v.role_name
WHERE NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.email = v.email
);

INSERT INTO delivery_personnel (delivery_person_id)
SELECT u.user_id
FROM users u
JOIN roles r ON r.role_id = u.user_role
WHERE r.role_name = 'delivery'
  AND u.email = 'delivery@shopsphere.test'
  AND NOT EXISTS (
      SELECT 1
      FROM delivery_personnel d
      WHERE d.delivery_person_id = u.user_id
  );
