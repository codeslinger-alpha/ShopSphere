import { useState } from "react";

// The star control, in two modes.
//
// Interactive is built from real <input type="radio"> elements with the stars as
// their labels, not <button>s. That is deliberate: the review form submits itself
// with `Object.fromEntries(new FormData(form))`, which reads checked radios and
// would read nothing at all from a button-based widget — the form would look
// right and quietly send no rating. Radios also come with the keyboard behaviour
// (arrow keys move within the group) and the announcement semantics for free.
//
// Read-only is the same stars as static markup with the rating as its accessible
// name, so a screen reader hears "4 out of 5 stars" rather than five graphics.
const STARS = [1, 2, 3, 4, 5];

// Drawn on a 24×24 grid: outer radius 9.2, inner 3.9, first point at the top.
const STAR_PATH =
  "M12 2.8 14.3 8.85 20.75 9.16 15.71 13.21 17.41 19.44 12 15.9 6.59 19.44 8.29 13.21 3.25 9.16 9.7 8.85Z";

function StarShape({ filled }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={STAR_PATH} />
    </svg>
  );
}

export default function StarRating({
  name = "rating",
  value,
  defaultValue = 5,
  onChange,
  readOnly = false,
  label = "Rating",
}) {
  const [picked, setPicked] = useState(defaultValue);
  // Hovering previews the rating without committing it, and clears as soon as
  // the pointer leaves the group via the container handler below.
  const [preview, setPreview] = useState(0);
  const selected = value ?? picked;
  const shown = preview || selected;

  if (readOnly) {
    return (
      <span
        className="star-rating readonly"
        role="img"
        aria-label={`${selected} out of 5 stars`}
      >
        {STARS.map((n) => (
          <span className={`star${n <= selected ? " filled" : ""}`} key={n}>
            <StarShape filled={n <= selected} />
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className="star-rating-field">
      <div
        className="star-rating"
        role="radiogroup"
        aria-label={label}
        onMouseLeave={() => setPreview(0)}
      >
        {STARS.map((n) => (
          <label
            className={`star${n <= shown ? " filled" : ""}`}
            key={n}
            onMouseEnter={() => setPreview(n)}
          >
            <input
              className="visually-hidden"
              type="radio"
              name={name}
              value={n}
              checked={selected === n}
              onChange={() => {
                setPicked(n);
                onChange?.(n);
              }}
            />
            <StarShape filled={n <= shown} />
            {/* A label wrapped around a graphic has no text to name the radio
                with, so the count is spelled out here and the graphic is
                aria-hidden. Without this the five radios are all just "radio". */}
            <span className="visually-hidden">
              {n} star{n === 1 ? "" : "s"}
            </span>
          </label>
        ))}
      </div>
      {/* Outside the radiogroup: a radiogroup may only own radios, and a live
          readout in a plain span is enough next to the spoken radio state. */}
      <span className="star-rating-value">{shown} out of 5</span>
    </div>
  );
}
