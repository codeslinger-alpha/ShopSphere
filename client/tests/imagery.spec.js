import { test, expect } from "@playwright/test";

// The four-stage image chain, and the category-to-illustration mapping behind it.
// None of this is visible to the server tests, and the mapping is the kind of
// thing that fails silently: a category with no matching stem still renders a
// perfectly good picture — the neutral parcel — so the page looks finished while
// showing the wrong thing. That is exactly what the seeded "Mobile Phones" and
// "Phone Accessories" categories did until a walkthrough caught it.

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

// The root categories the demo database actually holds, verbatim. If one of these
// ever resolves to category-other.svg, a real category tile has no illustration.
const SEEDED_ROOTS = [
    "Home Appliances",
    "Sports",
    "Groceries",
    "Fashion",
    "Electronics",
    "Mobile Phones",
    "Computers",
    "Beauty",
];

async function mockApi(page, { items = [] } = {}) {
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/auth/me") return route.fulfill({ status: 401, json: { message: "Authentication is required." } });
        if (url.pathname === "/api/categories") {
            return route.fulfill({
                json: SEEDED_ROOTS.map((name, index) => ({
                    category_id: index + 1,
                    name,
                    description: "",
                    parent_category: null,
                })),
            });
        }
        if (url.pathname === "/api/products/facets") return route.fulfill({ json: [] });
        if (url.pathname === "/api/products") {
            return route.fulfill({ json: { items, total: items.length, page: 1, limit: 24, total_pages: 1 } });
        }
        return route.fulfill({ status: 404, json: { message: "Route not found." } });
    });
}

// The illustrated path of the image currently rendered in a given card.
const artOf = (locator) => locator.evaluate((node) => new URL(node.querySelector("img").src).pathname);

test("every seeded root category has an illustration of its own", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");

    const tiles = page.locator(".category-tile");
    await expect(tiles).toHaveCount(SEEDED_ROOTS.length);

    for (const name of SEEDED_ROOTS) {
        const art = await artOf(tiles.filter({ hasText: name }));
        expect(art, `${name} fell through to the neutral parcel`).not.toBe("/img/category-other.svg");
        expect(art).toMatch(/^\/img\/category-[a-z]+\.svg$/);
    }
});

test("a phone category is electronics, not an unmatched name", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");

    // The specific regression: "Mobile Phones" contains no stem the electronics
    // row had, so a Galaxy S25 got the parcel while a keyboard got a chip.
    await expect(page.locator(".category-tile", { hasText: "Mobile Phones" }).locator("img")).toHaveAttribute(
        "src",
        "/img/category-electronics.svg",
    );
});

test("a listing photo fails over to its category illustration, not a grey box", async ({ page }) => {
    // Nothing serves the photo host, so stage 2 cannot succeed.
    await page.route("**images.unsplash.com/**", (route) => route.abort());
    await mockApi(page, {
        items: [listing({ name: "Anker Power Bank", category_name: "Phone Accessories" })],
    });

    await page.goto("/products");
    const card = page.locator(".product-card").first();
    await expect(card.locator("img.product-image")).toHaveAttribute("src", "/img/category-electronics.svg");
    // The stand-in is marked so it can be styled apart from a real listing photo.
    await expect(card.locator("img.product-image")).toHaveClass(/stand-in/);
    await expect(card.locator(".image-placeholder")).toHaveCount(0);
});

test("a listing the photo host does serve keeps its own picture", async ({ page }) => {
    await mockApi(page, { items: [listing({ name: "Wireless Keyboard" })] });
    await page.goto("/products");

    const image = page.locator(".product-card").first().locator("img.product-image");
    await expect(image).toHaveAttribute("src", /images\.unsplash\.com/);
    // The chosen photo is still not the listing's own, so it is a stand-in: the
    // class answers "did the shop upload this?", not "which stage is this?".
    await expect(image).toHaveClass(/stand-in/);
});

test("a listing with an image of its own is the one case that is not a stand-in", async ({ page }) => {
    await mockApi(page, {
        items: [listing({ name: "Wireless Keyboard", images: "https://cdn.example.test/own.jpg" })],
    });
    await page.goto("/products");

    const image = page.locator(".product-card").first().locator("img.product-image");
    await expect(image).toHaveAttribute("src", "https://cdn.example.test/own.jpg");
    await expect(image).not.toHaveClass(/stand-in/);
});
