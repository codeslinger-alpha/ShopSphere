const PROFILE = `SELECT u.user_id,u.name,u.email,u.phone_numbers AS phone,u.pfp,u.created_at,u.point,u.active_status,r.role_name,
 l.street_address,l.city,l.postal_code,l.state_province,l.country_id,d.vehicle_info,d.active_status AS delivery_status,d.earnings
 FROM users u LEFT JOIN roles r ON r.role_id=u.user_role LEFT JOIN locations l ON l.location_id=u.address
 LEFT JOIN delivery_personnel d ON d.delivery_person_id=u.user_id WHERE u.user_id=$1`;
const LIST_COUNTRIES = "SELECT country_id,country_name FROM countries ORDER BY country_name";
const LOCK_USER = "SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE";
const UPDATE_PROFILE = "UPDATE users SET name=$1,email=$2,phone_numbers=$3,pfp=$4,address=$5 WHERE user_id=$6";
const UPDATE_DELIVERY_VEHICLE = "UPDATE delivery_personnel SET vehicle_info=$1 WHERE delivery_person_id=$2";
module.exports = { LIST_COUNTRIES, LOCK_USER, PROFILE, UPDATE_DELIVERY_VEHICLE, UPDATE_PROFILE };
