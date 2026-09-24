import { useEffect, useState } from "react";
import { api, SESSION_EXPIRED_EVENT } from "../api/http";

import { AuthContext } from "./useAuth";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    function expireSession() {
      setUser(null);
      setSessionError("");
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession);
    api("/auth/me", { signal: controller.signal })
      .then(({ user: currentUser }) => {
        if (!controller.signal.aborted) setUser(currentUser);
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.status !== 401)
          setSessionError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => {
      controller.abort();
      window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession);
    };
  }, []);

  async function login(credentials) {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });

    setUser(data.user);
    setSessionError("");
    return data.user;
  }

  async function register(formData) {
    const data = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify(formData),
    });

    setUser(data.user);
    setSessionError("");
    return data.user;
  }

  async function refreshUser() {
    try {
      const data = await api("/auth/me");
      setUser(data.user);
      setSessionError("");
    } catch (error) {
      setSessionError(error.message);
    }
  }

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (error) {
      if (error.status !== 401) throw error; // An expired session is already signed out.
    }
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        isLoading,
        login,
        logout,
        register,
        user,
        sessionError,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
