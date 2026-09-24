// PostgreSQL INT is a signed 32-bit integer. Reject coercions such as true → 1.
function parsePositiveInteger(value) {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^[1-9]\d*$/.test(value))
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2147483647
    ? number
    : null;
}

const MAX_SEARCH_LENGTH = 200;
// numeric(12,2) in the schema: ten digits before the point and two after it.
const MAX_PRICE = 9999999999.99;
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;
const SORT_ORDERS = ["relevance", "newest", "price_asc", "price_desc", "name"];

// Catalog query-string values arrive as strings, or as arrays when a parameter
// repeats. Every parser below returns the parsed value, or null when the input
// is not acceptable; the caller decides the response. Absent values are handled
// by the caller before calling these, so an empty string is invalid here.

function parseSearchTerm(value) {
  if (typeof value !== "string") return null;
  const term = value.trim();
  return term.length <= MAX_SEARCH_LENGTH ? term : null;
}

function parsePrice(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  const price = Number(text);
  return price <= MAX_PRICE ? price : null;
}

function parsePage(value) {
  return parsePositiveInteger(value);
}

function parsePageSize(value) {
  const size = parsePositiveInteger(value);
  return size !== null && size <= MAX_PAGE_SIZE ? size : null;
}

function parseSort(value) {
  return SORT_ORDERS.includes(value) ? value : null;
}

// Filters constrained to a known set of values. Absent means "no filter", which
// the caller handles before calling this; anything else outside the set is
// rejected so a typo surfaces as a 400 instead of an empty page.
function parseChoice(value, choices) {
  return choices.includes(value) ? value : null;
}

// Facet checkboxes are sent as repeated `attribute=id:value` parameters. Values
// are grouped per attribute so the query can OR within one attribute and AND
// across attributes. Returns a Map, or null when any entry is malformed.
function parseAttributeFilters(value, maxFilters = 50) {
  const entries =
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  if (entries.length > maxFilters) return null;

  const grouped = new Map();
  for (const entry of entries) {
    if (typeof entry !== "string") return null;
    const separator = entry.indexOf(":");
    if (separator < 1) return null;
    const attributeId = parsePositiveInteger(entry.slice(0, separator));
    const attributeValue = entry.slice(separator + 1).trim();
    if (!attributeId || !attributeValue || attributeValue.length > 500)
      return null;

    if (!grouped.has(attributeId)) grouped.set(attributeId, []);
    const values = grouped.get(attributeId);
    if (!values.includes(attributeValue)) values.push(attributeValue);
  }
  return grouped;
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SORT_ORDERS,
  parseAttributeFilters,
  parseChoice,
  parsePage,
  parsePageSize,
  parsePositiveInteger,
  parsePrice,
  parseSearchTerm,
  parseSort,
};
