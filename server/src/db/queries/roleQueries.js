// Shared so the read and the write cannot drift apart and hand the workspace a
// profile missing a field it just saved.
const DELIVERY_PROFILE_COLUMNS = `vehicle_info,vehicle_type,vehicle_number,
    license_number,vehicle_model,active_status,earnings`;

const GET_DELIVERY_PROFILE = `
    SELECT ${DELIVERY_PROFILE_COLUMNS}
    FROM delivery_personnel WHERE delivery_person_id=$1
`;

const UPDATE_DELIVERY_PROFILE = `
    UPDATE delivery_personnel
    SET active_status=$1,vehicle_info=$2,vehicle_type=$3,vehicle_number=$4,
        license_number=$5,vehicle_model=$6
    WHERE delivery_person_id=$7
    RETURNING ${DELIVERY_PROFILE_COLUMNS}
`;

module.exports = { GET_DELIVERY_PROFILE, UPDATE_DELIVERY_PROFILE };
