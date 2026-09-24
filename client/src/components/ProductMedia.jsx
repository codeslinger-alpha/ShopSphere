import { useState } from "react";
import { categoryArt, photoFor } from "./imagery";

// Listings usually carry no image URL of their own, so what the customer sees is
// decided here. Four steps, each taken only when the one before it is missing or
// fails:
//
//   1. the listing's own image
//   2. a curated photo for the product name (imagery.js)
//   3. the category illustration (imagery.js)
//   4. the "No image" box
//
// Steps 2 and 3 are the fix for pictures that had nothing to do with the
// product: step 2 is chosen from the name, step 3 is topically right by
// construction. Only step 3 is local and guaranteed to load — the first two are
// remote — so with the network down every listing still lands somewhere
// relevant instead of on a grey box.
export default function ProductMedia({
  src,
  alt = "",
  className = "",
  name = "",
  art = "",
}) {
  const [stage, setStage] = useState(0);
  // One value covering everything that changes the picture, so a reused
  // component instance showing a different listing starts the chain over.
  const tracked = `${src ?? ""}|${name}|${art}`;
  const [trackedKey, setTrackedKey] = useState(tracked);
  // Adjusted during render rather than in an effect, matching Header's search
  // field: an effect would paint the previous listing's picture first.
  if (trackedKey !== tracked) {
    setTrackedKey(tracked);
    setStage(0);
  }

  const sources = [src, photoFor(name), art || categoryArt(name)].filter(Boolean);
  const current = sources[stage];
  const extra = className ? ` ${className}` : "";
  // "Is this the listing's own picture?" is the question the styling asks, so ask
  // it directly rather than inferring it from the stage number. A listing with no
  // image URL *and* no keyword match starts the chain at the category art, so
  // `stage` is 0 while the picture is still a stand-in — and the same illustration
  // would then be styled one way for "Anker Power Bank" and another for a name that
  // matched a photo and failed over to it.
  const isOwnImage = Boolean(src) && stage === 0;

  if (!current) {
    return <span className={`image-placeholder${extra}`}>No image</span>;
  }

  return (
    <img
      className={`product-image${isOwnImage ? "" : " stand-in"}${extra}`}
      src={current}
      alt={alt}
      loading="lazy"
      onError={() => setStage(stage + 1)}
    />
  );
}
