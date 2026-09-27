import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ContactFields, Feedback } from "../components/FormFields";
export default function AuthFlowPage() {
  const { register } = useAuth(),
    navigate = useNavigate();
  const [role, setRole] = useState("customer"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setError("");
    if (body.password !== body.confirm_password)
      return setError("Passwords do not match.");
    setBusy(true);
    try {
      await register(body);
      navigate("/dashboard");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <form className="panel form" onSubmit={submit}>
        <h1>Create your account</h1>
        <Feedback error={error} />
        <fieldset disabled={busy}>
          <label>
            <span>Name <span className="required-tag" aria-hidden="true">*</span></span>
            <input name="name" minLength="2" maxLength="100" required />
          </label>
          <label>
            Account type
            <select
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="customer">Customer</option>
              <option value="vendor">Shop owner</option>
              <option value="delivery">Delivery</option>
            </select>
          </label>
          <label>
            <span>Email <span className="required-tag" aria-hidden="true">*</span></span>
            <input name="email" type="email" maxLength="60" required />
          </label>
          <label>
            <span>Password <span className="required-tag" aria-hidden="true">*</span></span>
            <input
              name="password"
              type="password"
              minLength="8"
              maxLength="72"
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            <span>Confirm password <span className="required-tag" aria-hidden="true">*</span></span>
            <input
              name="confirm_password"
              type="password"
              minLength="8"
              maxLength="72"
              autoComplete="new-password"
              required
            />
          </label>
          <ContactFields delivery={role === "delivery"} />
          <button className="primary">
            {busy ? "Creating…" : "Create account"}
          </button>
        </fieldset>
        <Link className="link-button" to="/login">
          Already have an account? Sign in
        </Link>
        <p className="required-note">*required</p>
      </form>
    </main>
  );
}
