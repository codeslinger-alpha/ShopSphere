import { useEffect, useRef, useState } from "react";
import { api } from "../api/http";
export function useResource(path) {
  const [result, setResult] = useState(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ path, version, data, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ path, version, data: null, error: error.message });
      });
    return () => controller.abort();
  }, [path, version]);
  // Never expose a previous product's data or review permission while loading.
  const current = path && result?.path === path && result?.version === version;
  return {
    data: current ? result.data : null,
    error: current ? result.error : "",
    reload: () => setVersion((v) => v + 1),
  };
}

export function useTask() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const pending = useRef(false);
  async function run(action) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      setMessage(result?.message || "Saved.");
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, error, message, run };
}
