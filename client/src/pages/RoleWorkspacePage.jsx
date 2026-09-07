import { useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/http";
import { useAuth } from "../auth/useAuth";
import { useResource, useTask } from "../hooks/useResource";
import { ContactFields, Feedback } from "../components/FormFields";
export default function RoleWorkspacePage() {
  const { user } = useAuth(),
    task = useTask(),
    resource = useResource(
      user.role === "admin"
        ? "/users"
        : user.role === "delivery"
          ? "/delivery/profile"
          : null,
    );
  const [role, setRole] = useState("admin");
  if (user.role === "vendor") return <Navigate replace to="/vendor/shops" />;
  if (user.role === "customer") return <Navigate replace to="/cart" />;
  async function write(path, method, body) {
    const ok = await task.run(() =>
      api(path, { method, body: JSON.stringify(body) }),
    );
    if (ok) resource.reload();
    return ok;
  }
  return (
    <main className="content">
      <h1>
        {user.role === "admin" ? "User administration" : "Delivery workspace"}
      </h1>
      <Feedback error={task.error || resource.error} message={task.message} />
      {user.role === "delivery" ? (
        <>
          {resource.data && (
            <form
              key={resource.data.active_status}
              className="panel form"
              onSubmit={(e) => {
                e.preventDefault();
                write(
                  "/delivery/profile",
                  "PUT",
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
              }}
            >
              <label>
                Availability
                <select
                  name="active_status"
                  defaultValue={resource.data.active_status}
                >
                  <option value="available">Available</option>
                  <option value="unavailable">
                    Unavailable
                  </option>
                </select>
              </label>
              <label>
                Vehicle information
                <textarea
                  name="vehicle_info"
                  defaultValue={resource.data.vehicle_info || ""}
                  maxLength="500"
                  required
                />
              </label>
              <p>Earnings: {resource.data.earnings ?? 0}</p>
              <button className="primary" disabled={task.busy}>
                Save availability
              </button>
            </form>
          )}
        </>
      ) : (
        <div className="workspace-grid">
          <section>
            <h2>Users</h2>
            {resource.data?.map((u) => (
              <article className="collection-row" key={u.user_id}>
                <div>
                  <h3>{u.name}</h3>
                  <p>
                    {u.email} · {u.role_name} · {u.active_status} · ID{" "}
                    {u.user_id}
                  </p>
                </div>
                {u.user_id !== user.user_id && (
                  <button
                    disabled={task.busy}
                    onClick={() =>
                      write(`/admin/users/${u.user_id}/status`, "PUT", {
                        active_status:
                          u.active_status === "active" ? "disabled" : "active",
                      })
                    }
                  >
                    {u.active_status === "active" ? "Disable" : "Enable"}
                  </button>
                )}
              </article>
            ))}
          </section>
          <form
            className="panel form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                b = Object.fromEntries(new FormData(form));
              if (await write("/admin/users", "POST", b)) form.reset();
            }}
          >
            <h2>Create an account</h2>
            <p>
              Only administrators can create admin accounts. Your current
              session stays signed in.
            </p>
            <fieldset disabled={task.busy}>
              <label>
                Account type
                <select
                  name="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  {["admin", "customer", "vendor", "delivery"].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Name
                <input name="name" minLength="2" maxLength="100" required />
              </label>
              <label>
                Email
                <input name="email" type="email" maxLength="60" required />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  minLength="8"
                  maxLength="72"
                  required
                />
              </label>
              <label>
                Confirm password
                <input
                  name="confirm_password"
                  type="password"
                  minLength="8"
                  maxLength="72"
                  required
                />
              </label>
              <ContactFields delivery={role === "delivery"} />
              <button className="primary">Create account</button>
            </fieldset>
          </form>
        </div>
      )}
    </main>
  );
}
