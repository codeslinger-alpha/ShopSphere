const FIND_AUTH_USER_BY_ID = `
    SELECT u.user_id, u.name, u.email, u.active_status, u.token_version,
           r.role_id, r.role_name
    FROM users u
    JOIN roles r ON r.role_id = u.user_role
    WHERE u.user_id = $1
`;

module.exports = { FIND_AUTH_USER_BY_ID };
