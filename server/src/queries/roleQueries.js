const GET_DELIVERY_PROFILE =
  "SELECT vehicle_info,active_status,earnings FROM delivery_personnel WHERE delivery_person_id=$1";
const UPDATE_DELIVERY_PROFILE =
  "UPDATE delivery_personnel SET active_status=$1,vehicle_info=$2 WHERE delivery_person_id=$3 RETURNING vehicle_info,active_status,earnings";
const UPDATE_USER_STATUS =
  "UPDATE users SET active_status=$1, token_version=token_version+1 WHERE user_id=$2 RETURNING user_id,name,email,active_status";
module.exports = { GET_DELIVERY_PROFILE, UPDATE_DELIVERY_PROFILE, UPDATE_USER_STATUS };
