# The interface: tokens, themes, imagery and the star control

Four things about the client that are easy to get subtly wrong, and the reason each is
built the way it is. Nothing here is on the server.

## The token contract

`client/src/index.css` is the only file in the client that may contain a colour. Every
colour, radius and shadow in `App.css` is a `var(--…)` referring to one of these tokens.

That is a rule with one enforcement mechanism: `App.css` has no raw colour literals in it,
so retuning the palette is an edit to one file rather than a find-and-replace across the
stylesheet. Before the dark theme landed, six groups of values were literals in `App.css`;
they are tokens now (`--header-bg`, `--on-brand`, `--brand-solid`, `--brand-solid-hover`,
`--badge-bg`, `--footer-*`) precisely because they have to differ between themes, and a
literal cannot.

Two traps the token set is arranged to avoid:

- **The brand ramp inverts between themes.** `--brand-50` is the most recessed tint and
  `--brand-900` the deepest in both, so in light mode the ramp runs light-to-dark and in
  dark mode dark-to-light. `--brand-600` and `--brand-700` are therefore *text* colours in
  both themes and must never be used as a fill behind `--on-brand` — a dark-green fill with
  white text is exactly what dark mode is trying to stop being. Fills use `--brand-solid`
  and `--brand-solid-hover`, which stay dark enough for white text in either theme.
- **A rating is not a warning.** `--star` is its own token rather than a reuse of `--warn`,
  because a review showing a warning-coloured star reads as an alert everywhere a review
  is displayed.

**To add a token:** add it to *both* blocks. Both declare the same names on purpose — a
token that exists in one block and not the other silently inherits, which is how a
light-only colour ends up showing through on a dark page. The light block is
`:root[data-theme="light"]`; dark is plain `:root`.

## Dark by default, and no flash

| Piece | Where |
| --- | --- |
| The palettes | `client/src/index.css` — `:root` is dark, `:root[data-theme="light"]` is the original light palette |
| The hook | `client/src/hooks/useTheme.js` |
| The pre-mount script | an inline `<script>` in `client/index.html` |
| The toggle | `client/src/components/Header.jsx`, beside Sign out |

Dark is the default and is what `:root` carries, so a visitor with nothing stored gets the
dark theme with no attribute, no script and no JavaScript. The stored value lives in
`localStorage.shopsphere_theme` under the key `shopsphere_theme`, and the only value that
changes anything is `"light"`.

The inline script in `index.html` reads that key and sets `data-theme` on `<html>` before
React mounts. Without it a light-theme user would get a dark first paint and a flash on
every navigation — the reason it is a script in the document rather than an effect in the
hook is that an effect runs after the first paint by definition.

Every `localStorage` access is wrapped in `try`/`catch` in both places. It throws outright
in a sandboxed iframe and in some private-mode browsers, and losing a theme preference is
not worth a blank page: the failure mode is the default theme for one page load.

## Imagery: four stages, and only the third is guaranteed

`client/src/components/imagery.js` is the whole decision. `ProductMedia.jsx` walks it:

| Stage | Source | Fails when |
| --- | --- | --- |
| 1 | the listing's own `image_url` | it is `NULL`, which is every seeded listing |
| 2 | `photoFor(name)` — a curated photo chosen from the product name | the name matches no keyword, or the CDN is unreachable |
| 3 | `art` prop, else `categoryArt(categoryName)` — a locally drawn SVG | never |
| 4 | the "No image" box | — |

Stage 3 is the one that cannot fail, and that is the point of the ordering. A listing with
the network blocked used to land on a grey box; it now lands on the illustration for its
category. The worst case is a chip for a category rather than a landscape for a keyboard.

**The photos are fixed Unsplash CDN URLs, not a search.** Each `PHOTOS` entry is a
hand-picked photo id, so a given listing shows the same picture on every page load, no
account or API key is involved, and there is no per-request quota to exhaust. Product
keywords are matched on **whole words** (with a trailing plural "s" stripped, so
"headphones" reaches "headphone") — substring matching there would give "Lightweight
Running Shoes" the lamp photo on the strength of "light". Category names are matched on
**substrings** instead, because "Electronics" has to find the "electronic" stem.

`categoryArt()` never returns `""`. An unmatched name gets `category-other.svg`, the
neutral parcel, which reads as "a category" rather than as a wrong guess.

**To add a category illustration:** drop `client/public/img/category-<key>.svg` and add
`[stems, "<key>"]` to `CATEGORY_STEMS`, ordered before any entry it would otherwise be
shadowed by — the first match wins. Files are served straight from `public/`, so the path
is `/img/category-<key>.svg` and needs no import.

The illustrations carry their own colour and are theme-independent by design: the same file
reads identically on dark and light, which is why they are content rather than chrome. For
chrome, see below.

`ProductMedia` keys its state on `` `${src}|${name}|${art}` ``, so a reused instance showing
a different listing restarts the chain instead of showing the previous product's picture.
That reset is done during render rather than in an effect, matching the header's search
field — an effect would paint the previous listing's picture first.

Anything that is not the listing's own image carries the `.stand-in` class, which is the
hook for styling a substitute more quietly than a real listing photo. Note that the class
answers *"is this the listing's own picture?"* rather than *"is this stage 0?"* — those are
not the same question. A listing with no image URL and no keyword match starts the chain at
the category illustration, so its stage is 0 while its picture is still a stand-in; keying
the class on the stage would style the identical illustration two different ways depending
on whether the product's name happened to match a keyword.

## Action art is inline, category art is a file

`client/src/components/ActionArt.jsx` draws the glyphs for the places a screen asks the
user to *do* something — the dashboard tiles and the landing page's cards — and it is
inline SVG rather than a file, unlike the category illustrations. The distinction is
deliberate:

- A **category illustration is content.** It has to carry its own colour, and it must look
  the same in both themes. A file is right.
- **Action art is chrome.** It should take its colour from the theme, which
  `stroke="currentColor"` gives it and a downloaded `<img>` cannot — an `<img>` is not
  reachable by `currentColor` at all. Inline also costs no request per tile.

Every glyph is drawn on a 48×48 grid at one stroke weight, so the set reads as one set
rather than a pile of icons from different places. Unknown names fall back to the product
glyph rather than rendering nothing.

## The star control

`client/src/components/StarRating.jsx`, in two modes, used by both product reviews and shop
reviews so it is built once.

**Interactive is built from real `<input type="radio">` elements with the stars as their
`<label>`s** — not buttons. That is not a styling preference: the review form submits
itself with `Object.fromEntries(new FormData(form))`, which reads checked radios and would
read *nothing at all* from a button widget. A button-based control would look right and
quietly send no rating. Radios also bring the keyboard behaviour (arrow keys move within
the group) and the group announcement semantics for free.

Two consequences worth knowing before touching it:

- Each label wraps an `aria-hidden` graphic, so the count is spelled out in a
  `visually-hidden` span inside the label. Without it all five radios are announced as just
  "radio", with no way to tell them apart.
- The "`4 out of 5`" readout sits **outside** the `radiogroup`, because a radiogroup may
  only own radios.

Hovering previews the rating without committing it, and the preview clears in the group's
own `onMouseLeave`.

**Read-only is the same stars as static markup** with the rating as its accessible name, so
a screen reader hears "4 out of 5 stars" rather than five separate graphics.

In browsers this hooks up as: click the `.star` **label**, not the input. The input is
`visually-hidden`, so Playwright's `.check()` on it is intercepted by the site header — the
e2e specs click the label for that reason.

## The brand mark

`client/public/favicon.svg` is the marketplace mark — a shop awning over a sphere — and it
is also what both `Header.jsx` and `Footer.jsx` render as `.brand-mark`. One file for the
tab icon and the header means the two cannot drift apart.

The glyph sits on its own green field rather than being tinted by the page, so the same
file reads identically in dark and light. That is what lets a single asset serve both
themes without a second variant or a `currentColor` indirection.
