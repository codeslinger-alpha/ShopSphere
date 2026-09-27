import { useAuth } from "../auth/useAuth";
import { api } from "../api/http";
import { useResource, useTask } from "../hooks/useResource";
import { ContactFields, Feedback } from "../components/FormFields";
export default function ProfilePage() {
  const { user, refreshUser } = useAuth(),
    resource = useResource("/profile"),
    task = useTask();
  const p = resource.data;
  async function save(e) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    if (
      await task.run(() =>
        api("/profile", { method: "PUT", body: JSON.stringify(body) }),
      )
    ) {
      resource.reload();
      await refreshUser();
    }
  }
  return (
    <main className="content narrow">
      <h1>Account settings</h1>
      <Feedback error={task.error || resource.error} message={task.message} />
      {p ? (
        <>
          <form
            className="panel form"
            key={`${p.email}:${p.street_address}`}
            onSubmit={save}
          >
            <fieldset disabled={task.busy}>
              <label>
                <span>Name <span className="required-tag" aria-hidden="true">*</span></span>
                <input
                  name="name"
                  defaultValue={p.name}
                  maxLength="100"
                  minLength="2"
                  required
                />
              </label>
              <label>
                <span>Email <span className="required-tag" aria-hidden="true">*</span></span>
                <input
                  name="email"
                  type="email"
                  defaultValue={p.email}
                  maxLength="60"
                  required
                />
              </label>
              <ContactFields value={p} delivery={user.role === "delivery"} />
              <button className="primary">Save changes</button>
            </fieldset>
            <p className="required-note">*required</p>
          </form>
          <h2>Account information</h2>
          <dl>
            <dt>User ID</dt>
            <dd>{p.user_id}</dd>
            <dt>Role</dt>
            <dd>{p.role_name}</dd>
            <dt>Status</dt>
            <dd>{p.active_status}</dd>
            <dt>Points</dt>
            <dd>{p.point}</dd>
            <dt>Created</dt>
            <dd>{new Date(p.created_at).toLocaleString()}</dd>
            {user.role === "delivery" && (
              <>
                <dt>Earnings</dt>
                <dd>{p.earnings ?? 0}</dd>
                <dt>Availability</dt>
                <dd>{p.delivery_status}</dd>
              </>
            )}
          </dl>
          <p className="muted">
            ID, role, status and creation date are set when the account is made
            and are not editable here. Points are recorded but no longer earned;
            earnings shown for delivery personnel come from completed
            deliveries.
          </p>
        </>
      ) : (
        !resource.error && <p>Loading profile…</p>
      )}
    </main>
  );
}
