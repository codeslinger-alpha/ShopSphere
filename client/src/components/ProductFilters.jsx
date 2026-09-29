import { useEffect, useState } from "react";

// The search box writes to the URL only once the shopper pauses, so typing does
// not fire a request per keystroke.
const SEARCH_DEBOUNCE_MS = 300;

// Turns the flat /categories list into a depth-annotated list. A visited set
// keeps the render finite even if a category were ever parented into a loop
// (the admin catalog forbids cycles, but a bad row must not hang the page).
function flattenCategoryTree(categories) {
  const children = new Map();
  for (const category of categories) {
    const parent = category.parent_category ?? null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(category);
  }

  const rows = [];
  const seen = new Set();
  function visit(parent, ancestors) {
    for (const category of children.get(parent) ?? []) {
      if (seen.has(category.category_id)) continue;
      seen.add(category.category_id);
      rows.push({ ...category, depth: ancestors.length, ancestors });
      visit(category.category_id, [...ancestors, category.category_id]);
    }
  }
  visit(null, []);
  // Categories whose parent is missing from the list stay reachable at the top.
  for (const category of categories) {
    if (seen.has(category.category_id)) continue;
    seen.add(category.category_id);
    rows.push({ ...category, depth: 0, ancestors: [] });
    visit(category.category_id, [category.category_id]);
  }
  return rows;
}

// Facets arrive as one row per attribute value; the panel needs them grouped.
function groupFacets(facets) {
  const groups = new Map();
  for (const facet of facets ?? []) {
    if (!groups.has(facet.attribute_id)) {
      groups.set(facet.attribute_id, {
        attribute_id: facet.attribute_id,
        attribute_name: facet.attribute_name,
        values: [],
      });
    }
    groups.get(facet.attribute_id).values.push({
      value: facet.value,
      listing_count: facet.listing_count,
    });
  }
  return [...groups.values()];
}

// A checkbox identifies one attribute value. The API parses `id:value` by the
// first colon, so a value may itself contain colons.
function attributeKey(attributeId, value) {
  return `${attributeId}:${value}`;
}

export default function ProductFilters({
  categories,
  facets,
  selectedAttributes,
  selectedCategory,
  searchTerm,
  minPrice,
  maxPrice,
  onChange,
  onClear,
}) {
  const [expanded, setExpanded] = useState(new Set());
  const [search, setSearch] = useState(searchTerm);
  const [price, setPrice] = useState({ min: minPrice, max: maxPrice });

  // Clear-all and the back button rewrite the URL, so the drafts follow it.
  useEffect(() => setSearch(searchTerm), [searchTerm]);
  useEffect(() => setPrice({ min: minPrice, max: maxPrice }), [minPrice, maxPrice]);

  useEffect(() => {
    if (search === searchTerm) return;
    const timer = setTimeout(() => onChange({ q: search }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // onChange is recreated per render; the debounce must not restart with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchTerm]);

  const categoryRows = flattenCategoryTree(categories ?? []);
  const parents = new Set(
    (categories ?? []).map((category) => category.parent_category),
  );
  const facetGroups = groupFacets(facets);
  const hasFilters = Boolean(
    searchTerm || selectedCategory || selectedAttributes.length || minPrice || maxPrice,
  );

  return (
    <aside className="filter-panel" aria-label="Product filters">
      <div className="filter-search">
        <label htmlFor="catalog-search">Search products</label>
        <input
          id="catalog-search"
          type="search"
          value={search}
          placeholder="Name, brand..."
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onChange({ q: search });
            }
          }}
        />
      </div>

      {categoryRows.length > 0 && (
        <div className="filter-group">
          <h2>Categories</h2>
          <ul className="filter-options">
            {categoryRows
              .filter((category) =>
                category.ancestors.every((id) => expanded.has(id)),
              )
              .map((category) => (
              <li
                key={category.category_id}
                className="category-row"
                style={{ paddingLeft: `${category.depth * 0.9}rem` }}
              >
                {parents.has(category.category_id) ? (
                  <button
                    type="button"
                    className="category-toggle"
                    aria-label={`${expanded.has(category.category_id) ? "Collapse" : "Expand"} ${category.name}`}
                    aria-expanded={expanded.has(category.category_id)}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(category.category_id)) next.delete(category.category_id);
                        else next.add(category.category_id);
                        return next;
                      })
                    }
                  >
                    <span aria-hidden="true">
                      {expanded.has(category.category_id) ? "▾" : "▸"}
                    </span>
                  </button>
                ) : (
                  <span className="category-toggle-spacer" />
                )}
                <button
                  type="button"
                  className={
                    String(category.category_id) === String(selectedCategory)
                      ? "filter-option active"
                      : "filter-option"
                  }
                  aria-pressed={
                    String(category.category_id) === String(selectedCategory)
                  }
                  onClick={() =>
                    onChange({
                      category_id:
                        String(category.category_id) === String(selectedCategory)
                          ? ""
                          : category.category_id,
                    })
                  }
                >
                  {category.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {facetGroups.map((group) => (
        <fieldset className="filter-group" key={group.attribute_id}>
          <legend>{group.attribute_name}</legend>
          <ul className="filter-options">
            {group.values.map((facet) => {
              const key = attributeKey(group.attribute_id, facet.value);
              return (
                <li key={key}>
                  <label className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedAttributes.includes(key)}
                      onChange={() => {
                        const next = selectedAttributes.includes(key)
                          ? selectedAttributes.filter((item) => item !== key)
                          : [...selectedAttributes, key];
                        onChange({ attribute: next });
                      }}
                    />
                    <span>{facet.value}</span>
                    <span className="muted"> ({facet.listing_count})</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      <form
        className="filter-group"
        onSubmit={(event) => {
          event.preventDefault();
          onChange({ min_price: price.min, max_price: price.max });
        }}
      >
        <h2>Price</h2>
        <div className="filter-price">
          <label>
            Min
            <input
              type="number"
              min="0"
              step="0.01"
              value={price.min}
              onChange={(event) =>
                setPrice({ ...price, min: event.target.value })
              }
            />
          </label>
          <label>
            Max
            <input
              type="number"
              min="0"
              step="0.01"
              value={price.max}
              onChange={(event) =>
                setPrice({ ...price, max: event.target.value })
              }
            />
          </label>
          <button type="submit">Apply</button>
        </div>
      </form>

      {hasFilters && (
        <button type="button" className="filter-clear" onClick={onClear}>
          Clear all filters
        </button>
      )}
    </aside>
  );
}
