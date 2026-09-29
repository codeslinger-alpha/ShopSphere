const FIND_AUTH_USER_BY_ID = `
    SELECT u.user_id, u.name, u.email, u.pfp, u.active_status, u.token_version,
           r.role_id, r.role_name
    FROM users u
    JOIN roles r ON r.role_id = u.user_role
    WHERE u.user_id = $1
`;

const FIND_ROLE_BY_NAME = `
    SELECT role_id, role_name
    FROM roles
    WHERE role_name = $1
`;

const COUNTRY_EXISTS = `SELECT country_id FROM countries WHERE country_id = $1`;
const CREATE_LOCATION = `
    INSERT INTO locations (street_address, postal_code, city, state_province, country_id)
    VALUES ($1, $2, $3, $4, $5) RETURNING location_id
`;
const CREATE_USER = `
    INSERT INTO users (user_role, name, password_hash, email, phone_numbers, pfp, address)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING user_id, name, email, pfp, token_version
`;

const CREATE_DELIVERY_PERSONNEL = `
    INSERT INTO delivery_personnel (delivery_person_id, vehicle_info, earnings)
    VALUES ($1, $2, 0)
`;

const FIND_USER_BY_EMAIL = `
    SELECT u.user_id, u.name, u.email, u.pfp, u.password_hash, u.active_status, u.token_version,
           r.role_name
    FROM users u
    JOIN roles r ON r.role_id = u.user_role
    WHERE u.email = $1
`;

const INCREMENT_TOKEN_VERSION = `
    UPDATE users
    SET token_version = token_version + 1
    WHERE user_id = $1
`;

module.exports = {
  FIND_AUTH_USER_BY_ID,
  CREATE_DELIVERY_PERSONNEL,
  COUNTRY_EXISTS,
  CREATE_LOCATION,
  CREATE_USER,
  FIND_ROLE_BY_NAME,
  FIND_USER_BY_EMAIL,
  INCREMENT_TOKEN_VERSION,
};
