import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "shopsphere_theme";
const THEMES = ["dark", "light"];

// Dark is the default, so the only stored value that changes anything is
// "light" — but the guard is not just about the default. localStorage throws
// outright in a sandboxed iframe and in some private-mode browsers, and losing
// a theme preference is not worth a blank page, so every access is guarded.
function storedTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : "dark";
  } catch {
    return "dark";
  }
}

// The single place that writes the attribute. index.html's inline script does
// the same thing before React mounts, so there is no flash of the wrong theme;
// this keeps the DOM in step once React is driving.
export function useTheme() {
  const [theme, setTheme] = useState(storedTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Preference not persisted; the theme still applies for this page.
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}
