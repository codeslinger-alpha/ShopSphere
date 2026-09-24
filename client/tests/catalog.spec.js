import { test, expect } from "@playwright/test";

// The catalog keeps every filter in the URL and lets the server do the
// matching, so these tests drive the real client against controlled API
// responses. That covers the wiring the server tests cannot see: which query
// string a filter produces, and what the toolbar reports back.

const listing = (overrides) => ({
    prod_id: 1,
    name: "Keyboard",
    images: "",
    description: "A keyboard.",
    in_stock: 5,
    unit_price: "35.00",
    shop_name: "Shop",
    shop_id: 1,
    manufacturer: "Maker",
    master_prod_id: 1,
    category_id: 7,
    category_name: "Computers",
    ...overrides,
});

const categories = [
    { category_id: 7, name: "Computers", description: "", parent_category: null },
    { category_id: 23, name: "Computer Accessories", description: "", parent_category: 7 },
    { category_id: 8, name: "Beauty", description: "", parent_category: null },
];

const facets = [
    { attribute_id: 1, attribute_name: "Color", value: "Black", listing_count: 4 },
    { attribute_id: 1, attribute_name: "Color", value: "Blue", listing_count: 2 },
    { attribute_id: 2, attribute_name: "Connection", value: "USB", listing_count: 3 },
];

// Records every /api/products query string so a test can assert on it.
async function mockApi(page, { items = 5, limit = 24 } = {}) {
    const queries = [];
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/auth/me") return route.fulfill({ status: 401, json: { message: "Authentication is required." } });
        if (url.pathname === "/api/categories") return route.fulfill({ json: categories });
        if (url.pathname === "/api/products/facets") return route.fulfill({ json: facets });
        if (url.pathname === "/api/products") {
            queries.push(url.search);
            const page_ = Number(url.searchParams.get("page") || 1);
            const size = Number(url.searchParams.get("limit") || limit);
            return route.fulfill({
                json: {
                    items: Array.from({ length: Math.min(size, Math.max(items - (page_ - 1) * size, 0)) }, (_, index) =>
                        listing({ prod_id: (page_ - 1) * size + index + 1, name: `Keyboard ${(page_ - 1) * size + index + 1}` }),
                    ),
                    total: items,
                    page: page_,
                    limit: size,
                    total_pages: Math.ceil(items / size),
                },
            });
        }
        return route.fulfill({ status: 404, json: { message: "Route not found." } });
    });
    return queries;
}

test("filters reach the server as query parameters and survive a reload", async ({ page }) => {
    const queries = await mockApi(page);
    await page.goto("/products");

    await expect(page.locator(".results-summary")).toHaveText("Showing 1–5 of 5 products");
    expect(queries[0]).toContain("limit=24");

    await page.fill("#catalog-search", "keyboard");
    await expect(page).toHaveURL(/q=keyboard/);
    await expect.poll(() => queries.at(-1)).toContain("q=keyboard");

    // Selecting a parent category must send its own ID; the server expands it.
    await page.getByRole("button", { name: "Computers", exact: true }).click();
    await expect.poll(() => queries.at(-1)).toContain("category_id=7");

    // A checkbox whose tick is driven by a URL round trip: click, do not check().
    await page.locator(".filter-checkbox", { hasText: "Black" }).locator("input").click();
    await expect.poll(() => queries.at(-1)).toContain("attribute=1%3ABlack");

    // Any filter change drops back to page one instead of stranding the user.
    await expect(page).not.toHaveURL(/page=/);

    const deepLink = page.url();
    await page.reload();
    await expect(page.locator(".filter-checkbox", { hasText: "Black" }).locator("input")).toBeChecked();
    expect(page.url()).toBe(deepLink);
    await expect.poll(() => queries.at(-1)).toContain("attribute=1%3ABlack");
});

test("the header search box and the URL stay in step", async ({ page }) => {
    const queries = await mockApi(page);

    // Landing on a deep link must populate the box, not leave it blank.
    await page.goto("/products?q=keyboard");
    await expect(page.locator("#header-search-input")).toHaveValue("keyboard");

    // The header box writes the same URL parameter the filter panel reads.
    await page.fill("#header-search-input", "lamp");
    await page.locator("#header-search-input").press("Enter");
    await expect(page).toHaveURL(/q=lamp/);
    await expect.poll(() => queries.at(-1)).toContain("q=lamp");

    // Leaving the catalog clears it rather than stranding a stale term.
    await page.goto("/");
    await expect(page.locator("#header-search-input")).toHaveValue("");
});

test("the toolbar range follows the page size actually requested", async ({ page }) => {
    await mockApi(page, { items: 11 });
    await page.goto("/products?limit=3");

    await expect(page.locator(".results-summary")).toHaveText("Showing 1–3 of 11 products");
    await expect(page.locator(".product-card")).toHaveCount(3);

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator(".results-summary")).toHaveText("Showing 4–6 of 11 products");
    await expect(page).toHaveURL(/page=2/);

    await page.getByRole("button", { name: "4", exact: true }).click();
    await expect(page.locator(".results-summary")).toHaveText("Showing 10–11 of 11 products");
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
});

test("attribute checkboxes OR within an attribute and AND across attributes", async ({ page }) => {
    const queries = await mockApi(page);
    await page.goto("/products");

    await page.locator(".filter-checkbox", { hasText: "Black" }).locator("input").click();
    await page.locator(".filter-checkbox", { hasText: "Blue" }).locator("input").click();
    await expect.poll(() => queries.at(-1)).toContain("attribute=1%3ABlack&attribute=1%3ABlue");

    await page.locator(".filter-checkbox", { hasText: "USB" }).locator("input").click();
    await expect.poll(() => queries.at(-1)).toContain("attribute=2%3AUSB");

    // Facet counts stay put while boxes are ticked, rather than collapsing to
    // the current selection.
    await expect(page.locator(".filter-checkbox")).toHaveText([
        "Black (4)",
        "Blue (2)",
        "USB (3)",
    ]);

    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(page).not.toHaveURL(/attribute=/);
    await expect(page.locator(".filter-checkbox input:checked")).toHaveCount(0);
});

test("a filter panel that fails to load leaves the grid usable", async ({ page }) => {
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/me") return route.fulfill({ status: 401, json: {} });
        if (path === "/api/products") {
            return route.fulfill({ json: { items: [listing({})], total: 1, page: 1, limit: 24, total_pages: 1 } });
        }
        return route.fulfill({ status: 500, json: { message: "Catalog unavailable." } });
    });

    await page.goto("/products");
    await expect(page.locator(".product-card")).toHaveCount(1);
    await expect(page.locator(".filter-panel")).toHaveCount(0);
    await expect(page.locator(".results-summary")).toHaveText("Showing 1–1 of 1 product");
});

test("a rejected filter reports the server message instead of an empty catalog", async ({ page }) => {
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/me") return route.fulfill({ status: 401, json: {} });
        if (path === "/api/categories") return route.fulfill({ json: categories });
        if (path === "/api/products/facets") return route.fulfill({ json: facets });
        return route.fulfill({ status: 400, json: { message: "Sort must be one of: relevance, newest." } });
    });

    await page.goto("/products?sort=bogus");
    await expect(page.getByRole("alert")).toHaveText("Sort must be one of: relevance, newest.");
    await expect(page.locator(".product-card")).toHaveCount(0);
    await expect(page.locator(".empty-state")).toHaveCount(0);
});
