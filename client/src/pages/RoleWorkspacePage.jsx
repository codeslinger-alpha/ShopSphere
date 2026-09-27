import { Link } from "react-router-dom";
import { api } from "../api/http";
import { useAuth } from "../auth/useAuth";
import { useResource, useTask } from "../hooks/useResource";
import { Feedback } from "../components/FormFields";

// The delivery workspace. User administration and the master catalog both live
// in their own /admin console; this page answers only to the delivery role.
export default function RoleWorkspacePage() {
  const { user } = useAuth();
  const task = useTask();
  const resource = useResource("/delivery/profile");

  async function write(path, method, body) {
    const ok = await task.run(() =>
      api(path, { method, body: JSON.stringify(body) }),
    );
    if (ok) resource.reload();
    return ok;
  }

  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{user.role} workspace</p>
          <h1>Delivery workspace</h1>
        </div>
        <Link to="/delivery/deliveries">Current deliveries</Link>
      </div>
      <Feedback error={task.error || resource.error} message={task.message} />
      {resource.data && (
        <form
          // Remounted when the saved status changes so the uncontrolled
          // selects and inputs pick up what the server actually stored.
          key={resource.data.active_status}
          className="panel form"
          onSubmit={(event) => {
            event.preventDefault();
            write(
              "/delivery/profile",
              "PUT",
              Object.fromEntries(new FormData(event.currentTarget)),
            );
          }}
        >
          <label>
            Availability
            <select
              name="active_status"
              defaultValue={resource.data.active_status}
            >
              <option value="available">Available for orders</option>
              <option value="on_delivery">On a delivery now</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>

          {/* Only the free-text notes are required. A courier on a bicycle has
              no plate or licence to give, and the server accepts that. */}
          <label>
            <span>Vehicle information <span className="required-tag" aria-hidden="true">*</span></span>
            <textarea
              name="vehicle_info"
              defaultValue={resource.data.vehicle_info || ""}
              maxLength="500"
              placeholder="Anything the shop should know — capacity, access notes."
              required
            />
          </label>
          <label>
            Vehicle type
            <select name="vehicle_type" defaultValue={resource.data.vehicle_type || ""}>
              <option value="">Not specified</option>
              <option value="motorcycle">Motorcycle</option>
              <option value="car">Car</option>
              <option value="van">Van</option>
              <option value="bicycle">Bicycle</option>
            </select>
          </label>
          <label>
            Vehicle number
            <input
              name="vehicle_number"
              defaultValue={resource.data.vehicle_number || ""}
              maxLength="40"
              placeholder="Registration or plate"
            />
          </label>
          <label>
            Vehicle model
            <input
              name="vehicle_model"
              defaultValue={resource.data.vehicle_model || ""}
              maxLength="100"
              placeholder="Make and model"
            />
          </label>
          <label>
            Licence number
            <input
              name="license_number"
              defaultValue={resource.data.license_number || ""}
              maxLength="60"
            />
          </label>
          <p>Earnings: {resource.data.earnings ?? 0}</p>
          <button className="primary" disabled={task.busy}>
            Save availability
          </button>
          <p className="required-note">*required</p>
        </form>
      )}
    </main>
  );
}
