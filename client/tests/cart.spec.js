import { test, expect } from "@playwright/test";

const user = { user_id: 1, name: "Customer", email: "customer@example.test", role: "customer" };
const item = { prod_id: 1, name: "Keyboard", shop_name: "Shop", unit_price: "10.00", subtotal: "20.00", quantity: 2, in_stock: 5, available: true };

async function mockApi(page, currentUser = user) {
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/me") return route.fulfill({ status: currentUser ? 200 : 401, json: currentUser ? { user: currentUser } : { message: "Authentication is required." } });
        if (path === "/api/cart") return route.fulfill({ json: [item] });
        if (path === "/api/wishlist") return route.fulfill({ json: [{ ...item, prod_id: 2, name: "Wishlist watch" }] });
        if (path === "/api/products") return route.fulfill({ json: [{ ...item, in_stock: 0 }] });
        return route.fulfill({ status: 404, json: { message: "Route not found." } });
    });
}

test("drafts do not save on blur; invalid quantities restore the saved value", async ({ page }) => {
    await mockApi(page);
    let writes = 0;
    await page.route("**/api/cart/1", (route) => { writes++; return route.fulfill({ status: 500, json: {} }); });
    await page.goto("/cart");
    const quantity = page.getByRole("spinbutton");
    await expect(quantity).toHaveAttribute("max", "5");
    await quantity.fill("3");
    await quantity.blur();
    await expect(page.getByText("Saved quantity: 2 · Subtotal: $20.00")).toBeVisible();
    expect(writes).toBe(0);
    for (const invalid of ["999", "0", "-1", "1.5", ""]) {
        await quantity.fill(invalid);
        await page.getByRole("button", { name: "Update", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("between 1 and 5");
        await expect(quantity).toHaveValue("2");
    }
    expect(writes).toBe(0);
});

test("Update saves an absolute quantity and uses the confirmed subtotal", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/cart/1", (route) => {
        expect(route.request().method()).toBe("PUT");
        expect(route.request().postDataJSON()).toEqual({ quantity: 3 });
        return route.fulfill({ json: { item: { ...item, quantity: 3, subtotal: "30.00" } } });
    });
    await page.goto("/cart");
    await page.getByRole("spinbutton").fill("3");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page.getByRole("spinbutton")).toHaveValue("3");
    await expect(page.getByText("Saved quantity: 3 · Subtotal: $30.00")).toBeVisible();
});

test("stock rejection restores the saved quantity and updates the maximum", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/cart/1", (route) => route.fulfill({ status: 409, json: { message: "Only 3 units are currently available.", item: { ...item, in_stock: 3 } } }));
    await page.goto("/cart");
    await page.getByRole("spinbutton").fill("4");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Only 3");
    await expect(page.getByRole("spinbutton")).toHaveValue("2");
    await expect(page.getByRole("spinbutton")).toHaveAttribute("max", "3");
});

test("network failure restores the draft and reports the error", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/cart/1", (route) => route.abort("failed"));
    await page.goto("/cart");
    await page.getByRole("spinbutton").fill("3");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not connect to the server");
    await expect(page.getByRole("spinbutton")).toHaveValue("2");
});

test("pending update blocks duplicate writes and removal", async ({ page }) => {
    await mockApi(page);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let writes = 0;
    await page.route("**/api/cart/1", async (route) => {
        writes++;
        await gate;
        await route.fulfill({ json: { item: { ...item, quantity: 3, subtotal: "30.00" } } });
    });
    await page.goto("/cart");
    await page.getByRole("spinbutton").fill("3");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page.getByRole("button", { name: "Update", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
    release();
    await expect(page.getByText("Saved quantity: 3 · Subtotal: $30.00")).toBeVisible();
    expect(writes).toBe(1);
});

test("a late cart response cannot overwrite the wishlist", async ({ page }) => {
    await mockApi(page);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/cart", async (route) => {
        await gate;
        await route.fulfill({ json: [item] }).catch(() => {});
    });
    await page.goto("/cart");
    await page.getByRole("link", { name: "Wishlist", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Wishlist watch" })).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "Keyboard" })).toHaveCount(0);
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
});

test("an expired session returns to a usable login form", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/cart/1", (route) => route.fulfill({ status: 401, json: { message: "Your session is no longer valid." } }));
    await page.goto("/cart");
    await page.getByRole("spinbutton").fill("3");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("unavailable existing items can still be removed", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/cart", (route) => route.fulfill({ json: [{ ...item, in_stock: 0, available: false }] }));
    await page.route("**/api/cart/1", (route) => route.fulfill({ status: 204 }));
    await page.goto("/cart");
    await expect(page.getByText("Currently unavailable")).toBeVisible();
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("Your cart is empty.")).toBeVisible();
});

test("out-of-stock products disable cart but keep wishlist and its server message", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/wishlist", (route) => route.fulfill({ json: { message: "Product is already in your wishlist." } }));
    await page.goto("/products");
    await expect(page.getByRole("button", { name: "Out of stock" })).toBeDisabled();
    await page.getByRole("button", { name: "Wishlist", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Product is already in your wishlist.");
});

test("dashboard links work and signed-in users cannot open account forms", async ({ page }) => {
    await mockApi(page);
    await page.goto("/register");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("link", { name: "Manage cart" }).click();
    await expect(page.getByRole("heading", { name: "My cart" })).toBeVisible();
    await page.getByRole("link", { name: "ShopSphere", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "My dashboard" })).toBeVisible();
});

test("collection load failures do not claim the collection is empty", async ({ page }) => {
    await mockApi(page);
    await page.route("**/api/cart", (route) => route.fulfill({ status: 500, json: { message: "Could not load the cart." } }));
    await page.goto("/cart");
    await expect(page.getByRole("alert")).toContainText("Could not load the cart");
    await expect(page.getByText("Your cart is empty.")).toHaveCount(0);
});
