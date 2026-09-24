import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/http";
import { useAuth } from "../auth/useAuth";
import { useResource } from "../hooks/useResource";
import ProductCard from "../components/ProductCard";
import ProductFilters from "../components/ProductFilters";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 24;
const SORT_LABELS = [
  ["relevance", "Most relevant"],
  ["newest", "Newest first"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
  ["name", "Name: A to Z"],
];

export default function ProductsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const requestPending = useRef(false);

  // The URL is the single source of truth for every filter, so a result page
  // survives reload, the back button and being pasted into another tab.
  const selectedAttributes = searchParams.getAll("attribute");
  const params = {
    q: searchParams.get("q") ?? "",
    category_id: searchParams.get("category_id") ?? "",
    min_price: searchParams.get("min_price") ?? "",
    max_price: searchParams.get("max_price") ?? "",
    sort: searchParams.get("sort") ?? "relevance",
    page: Number(searchParams.get("page") ?? 1) || 1,
  };

  const listQuery = new URLSearchParams(searchParams);
  if (!listQuery.has("limit")) listQuery.set("limit", String(PAGE_SIZE));
  const products = useResource(`/products?${listQuery}`);
  // Facet counts describe the current search, category and price but must not
  // collapse to whatever boxes are already ticked.
  const facetQuery = new URLSearchParams(searchParams);
  for (const key of ["attribute", "page", "sort", "limit"]) {
    facetQuery.delete(key);
  }
  const facetsPath = `/products/facets${
    facetQuery.size ? `?${facetQuery}` : ""
  }`;
  const facets = useResource(facetsPath);
  const categories = useResource("/categories");

  function updateParams(changes) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (Array.isArray(value)) {
        for (const entry of value) next.append(key, entry);
      } else if (value !== "" && value != null) {
        next.set(key, value);
      }
    }
    // Any filter change resets paging; page changes keep the rest.
    if (!("page" in changes)) next.delete("page");
    setSearchParams(next);
  }

  async function add(path, productId, successMessage) {
    if (requestPending.current) return;
    setError("");
    setMessage("");
    if (user?.role !== "customer") {
      setError("Sign in as a customer to use this feature.");
      return;
    }

    requestPending.current = true;
    setIsAdding(true);
    try {
      const data = await api(path, {
        method: "POST",
        body: JSON.stringify({ prod_id: productId, quantity: 1 }),
      });
      setMessage(data.message || successMessage);
    } catch (error) {
      setError(error.message);
    } finally {
      requestPending.current = false;
      setIsAdding(false);
    }
  }

  const items = products.data?.items ?? [];
  const total = products.data?.total ?? 0;
  const totalPages = products.data?.total_pages ?? 0;
  // The server echoes the limit it applied, which is what the URL asked for and
  // not necessarily the default page size.
  const limit = products.data?.limit ?? PAGE_SIZE;
  const firstResult = total === 0 ? 0 : (params.page - 1) * limit + 1;
  const lastResult = Math.min(params.page * limit, total);

  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Catalog</p>
          <h1>Find what you need</h1>
        </div>
        <Link to="/">Back home</Link>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      <div className="catalog-layout">
        {/* A filter panel that fails to load must not take the grid with it. */}
        {(categories.data || facets.data) && (
          <ProductFilters
            categories={categories.data}
            facets={facets.data}
            selectedAttributes={selectedAttributes}
            selectedCategory={params.category_id}
            searchTerm={params.q}
            minPrice={params.min_price}
            maxPrice={params.max_price}
            onChange={updateParams}
            onClear={() => setSearchParams(new URLSearchParams())}
          />
        )}

        <section className="catalog-results">
          <div className="results-toolbar">
            {/* aria-live rather than role="status": the add-to-cart notice
                already owns that role, and two live regions with the same role
                make both ambiguous to assistive technology and to tests. */}
            <p className="results-summary" aria-live="polite">
              {products.isLoading
                ? "Loading products..."
                : `Showing ${firstResult}–${lastResult} of ${total} product${
                    total === 1 ? "" : "s"
                  }`}
            </p>
            <label className="results-sort">
              Sort by
              <select
                value={params.sort}
                onChange={(event) => updateParams({ sort: event.target.value })}
              >
                {SORT_LABELS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {products.error && (
            <p className="error" role="alert">
              {products.error}
            </p>
          )}

          {!products.isLoading && !products.error && items.length === 0 && (
            <p className="empty-state">
              No products match these filters. Try clearing some.
            </p>
          )}

          <div className="product-grid">
            {items.map((product) => (
              <ProductCard
                key={product.prod_id}
                product={product}
                isAdding={isAdding}
                onAdd={user?.role === "customer" ? add : null}
              />
            ))}
          </div>

          <Pagination
            page={params.page}
            totalPages={totalPages}
            onPage={(page) => updateParams({ page: String(page) })}
          />
        </section>
      </div>
    </main>
  );
}
