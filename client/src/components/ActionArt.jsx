// Art for the places a screen asks the user to *do* something — the dashboard
// tiles and the landing page's cards.
//
// Inline rather than files on purpose. A category illustration is content and
// has to carry its own colour; this is chrome, and chrome should take its colour
// from the theme, which `stroke="currentColor"` does and a downloaded <img>
// cannot. It also costs no request per tile.
//
// Every glyph is drawn on a 48×48 grid for a single stroke weight, so the set
// looks like one set rather than a pile of icons.
const GLYPHS = {
  products: (
    <>
      <path d="M13 16h22l3 24H10z" />
      <path d="M18 16a6 6 0 0 1 12 0" />
    </>
  ),
  cart: (
    <>
      <path d="M6 9h5l4 21h23l3.5-14H12" />
      <circle cx="17" cy="38" r="3" />
      <circle cx="34" cy="38" r="3" />
    </>
  ),
  wishlist: (
    <path d="M24 39S8.5 29.5 8.5 19.5A8.5 8.5 0 0 1 24 15a8.5 8.5 0 0 1 15.5 4.5C39.5 29.5 24 39 24 39z" />
  ),
  orders: (
    <>
      <path d="M8 16 24 8l16 8v16l-16 8-16-8z" />
      <path d="m8 16 16 8 16-8M24 24v16" />
      <path d="m29 33 4 4 9-9" />
    </>
  ),
  vendor: (
    <>
      <path d="M6 17h36l-3-9H9z" />
      <path d="M9 17v23h30V17" />
      <path d="M20 40V28h8v12" />
    </>
  ),
  delivery: (
    <>
      <path d="M5 12h20v18H5z" />
      <path d="M25 19h9l7 7v4H25z" />
      <circle cx="14" cy="34" r="3.4" />
      <circle cx="34" cy="34" r="3.4" />
    </>
  ),
  admin: (
    <>
      <path d="M7 38a17 17 0 0 1 34 0" />
      <path d="m24 38 9-11" />
      <circle cx="24" cy="38" r="2.6" />
    </>
  ),
  search: (
    <>
      <circle cx="21" cy="21" r="12" />
      <path d="m30 30 11 11" />
    </>
  ),
  compare: (
    <>
      <path d="M11 8v32M37 8v32" />
      <path d="M4 20h14M30 30h14" />
    </>
  ),
  user: (
    <>
      <circle cx="24" cy="16" r="8" />
      <path d="M9 41a15 15 0 0 1 30 0" />
    </>
  ),
};

export default function ActionArt({ name, className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      width="48"
      height="48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name] ?? GLYPHS.products}
    </svg>
  );
}
