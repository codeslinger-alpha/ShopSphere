// Where a picture comes from when a listing has no image URL of its own — which
// is every listing in the seeded catalogue, and most in a fresh one.
//
// Two lookups, tried in order by ProductMedia:
//
//   1. photoFor(name) — a curated photograph chosen from the product's name.
//      These are fixed Unsplash CDN URLs, not a search: the id was picked once
//      by hand, so a given listing shows the same photo on every page load and
//      no account, key or per-request quota is involved. Reads from that CDN are
//      plain image requests.
//   2. categoryArt(categoryName) — a locally drawn SVG, one per category. This
//      is the step that never fails, and it is why a keyboard can no longer show
//      a landscape: the worst case is now a chip for an electronics listing.
//
// The product keywords are matched on whole words, so "Lightweight Running
// Shoes" does not match the lamp photo on the strength of "light". Category
// names are matched on substrings instead, because "Electronics" has to find
// the "electronic" stem.

const UNSPLASH = "https://images.unsplash.com/photo-";
const PHOTO_PARAMS = "auto=format&fit=crop&w=600&h=400&q=70";

// Ordered most-specific-first: the first entry with a matching keyword wins, so
// a product named "Wireless Mouse" reaches the mouse photo rather than the
// keyboard one.
const PHOTOS = [
  [["keyboard", "keypad"], "1587829741301-dc798b83add3"],
  [["headphone", "earphone", "earbud", "headset"], "1505740420928-5e560c06d30e"],
  [["watch", "smartwatch"], "1546868871-7041f2a55e12"],
  [["lamp"], "1519219788971-8d9797e0928e"],
  [["laptop", "notebook", "macbook"], "1496181133206-80ce9b88a853"],
  [["mouse"], "1527864550417-7fd91fc51a46"],
  [["speaker", "soundbar"], "1608043152269-423dbba4e7e1"],
  [["shirt", "tee", "tshirt"], "1581655353564-df123a1eb820"],
];

// A category name is matched by substring against these stems, in order, so
// "Demo Electronics" finds "electronic" and "Home & Kitchen" finds "home".
//
// "phone"/"mobile"/"tablet" are here because the seeded catalog has a whole
// "Mobile Phones" root and a "Phone Accessories" child, and neither contains a
// stem the electronics row already had: without them a power bank fell through
// to the neutral parcel while a keyboard did not.
const CATEGORY_STEMS = [
  [["electronic", "computer", "audio", "camera", "gadget", "tech", "phone", "mobile", "tablet"], "electronics"],
  [["home", "kitchen", "furniture", "garden", "appliance"], "home"],
  [["cloth", "apparel", "fashion", "wear", "shoe", "bag"], "apparel"],
  [["grocer", "food", "drink", "fresh", "snack", "beverage"], "groceries"],
  [["book", "stationery", "office", "magazine"], "books"],
  [["sport", "outdoor", "fitness", "bike", "cycl"], "sports"],
  [["toy", "game", "kid", "baby", "puzzle"], "toys"],
  [["beauty", "health", "cosmetic", "care", "personal"], "beauty"],
];

const ART_DIRECTORY = "/img";

// Whole words, with a trailing plural "s" dropped so "headphones" reaches the
// "headphone" keyword. Words of four letters or fewer are left alone: "ts" is
// not a word, and stripping it would break "tshirt".
function words(name) {
  return String(name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word));
}

// A curated photo for this product name, or "" when nothing matches. The caller
// reads "" as "move on to the category illustration".
export function photoFor(name) {
  const tokens = words(name);
  if (!tokens.length) return "";
  const match = PHOTOS.find(([keywords]) =>
    keywords.some((keyword) => tokens.includes(keyword)),
  );
  return match ? `${UNSPLASH}${match[1]}?${PHOTO_PARAMS}` : "";
}

// The drawn illustration for a category name. Never returns "" — an unmatched
// name gets the neutral parcel, which reads as "a category" rather than as a
// wrong guess.
export function categoryArt(categoryName) {
  const haystack = String(categoryName ?? "").toLowerCase();
  const match = CATEGORY_STEMS.find(([stems]) =>
    stems.some((stem) => haystack.includes(stem)),
  );
  return `${ART_DIRECTORY}/category-${match ? match[1] : "other"}.svg`;
}
