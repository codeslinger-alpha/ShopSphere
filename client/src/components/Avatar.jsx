import { useState } from "react";

export default function Avatar({ name = "Account", src, large = false, decorative = false }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  const label = `${name}'s profile photo`;
  return src && src !== failedSrc ? (
    <img className={`avatar${large ? " avatar-large" : ""}`} src={src}
      alt={decorative ? "" : label} referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)} />
  ) : (
    <span className={`avatar${large ? " avatar-large" : ""}`}
      role={decorative ? undefined : "img"} aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}>{initials}</span>
  );
}
