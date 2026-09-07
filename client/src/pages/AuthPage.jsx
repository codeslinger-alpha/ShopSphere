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
            Email
            <input
              name="email"
              type="email"
              maxLength="60"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
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
      </form>
    </main>
  );
}
