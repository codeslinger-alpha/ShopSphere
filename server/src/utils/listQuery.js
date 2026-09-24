const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseChoice,
  parsePage,
  parsePageSize,
  parseSearchTerm,
} = require("./validation");

// Shared by every paged list on the server. The admin console, the storefront
// catalog and the payment screens all send the same four parameters — search
// text, a value from a closed set, a page and a size — and they must all answer
// a bad one the same way: a 400 naming the parameter, rather than a silently
// dropped filter that returns the whole table and looks like a match.
//
// `choices` maps a parameter name to the values it accepts, for example
// { status: SHOP_STATUSES, method: PAYMENT_METHODS }. A caller building SQL by
// pushing parameters in order gets a deterministic numbering because the keys
// are read in insertion order.

function capitalise(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Query-string values arrive as strings, or as arrays when a parameter repeats.
// An absent value means "no filter"; anything present but unparseable is a 400
// so a typo surfaces immediately instead of quietly returning everything.
function parseListQuery(query = {}, choices = {}) {
  const filters = { q: "", page: 1, limit: DEFAULT_PAGE_SIZE };
  for (const name of Object.keys(choices)) filters[name] = null;

  if (query.q !== undefined) {
    const term = parseSearchTerm(query.q);
    if (term === null)
      return { error: "Search text must be at most 200 characters." };
    filters.q = term;
  }

  for (const [name, values] of Object.entries(choices)) {
    if (query[name] === undefined) continue;
    // parseChoice rejects a repeated parameter (an array) as well as an unknown
    // value, because neither is a filter anyone meant to send.
    const value = parseChoice(query[name], values);
    if (!value)
      return { error: `${capitalise(name)} must be one of: ${values.join(", ")}.` };
    filters[name] = value;
  }

  if (query.page !== undefined) {
    const page = parsePage(query.page);
    if (!page) return { error: "Page must be a positive integer." };
    filters.page = page;
  }

  if (query.limit !== undefined) {
    const limit = parsePageSize(query.limit);
    if (!limit) return { error: `Limit must be between 1 and ${MAX_PAGE_SIZE}.` };
    filters.limit = limit;
  }

  return { filters };
}

// COUNT(*) OVER() rides on the first row of the page, so the total costs no
// second round trip. An empty page means a total of zero, which is what lets
// the client render "nothing matched" rather than "page 4 of 3".
function paginated(rows, page, limit) {
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map(({ total_count, ...item }) => item),
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  };
}

module.exports = { paginated, parseListQuery };
