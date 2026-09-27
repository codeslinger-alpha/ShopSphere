import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { Link, useNavigate } from "react-router-dom";

export default function AuthPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(Object.fromEntries(new FormData(event.currentTarget)));
      navigate("/dashboard");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <form className="panel form" onSubmit={submit}>
        <p className="eyebrow">ShopSphere account</p>
        <h1>Welcome back</h1>
        <fieldset disabled={busy}>
          <label>
            <span>Email <span className="required-tag" aria-hidden="true">*</span></span>
            <input
              name="email"
              type="email"
              maxLength="60"
              autoComplete="username"
              required
            />
          </label>
          <label>
            <span>Password <span className="required-tag" aria-hidden="true">*</span></span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary">
            {busy ? "Please wait..." : "Sign in"}
          </button>
        </fieldset>
        <Link className="link-button" to="/register">
          Need an account? Sign up
        </Link>
        <p className="required-note">*required</p>
      </form>
    </main>
  );
}
