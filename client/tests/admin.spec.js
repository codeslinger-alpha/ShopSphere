import { test, expect } from "@playwright/test";

// The admin console keeps its tab and every filter in the URL and lets the
// server do the matching, so these tests drive the real client against
// controlled API responses. That covers the wiring the server tests cannot see:
// which request a tab or a filter produces, and what the table reports back.

const admin = { user_id: 9, name: "Admin", email: "admin@example.test", role: "admin" };

const account = (overrides) => ({
    user_id: 1,
    name: "Demo Customer",
    email: "customer@example.test",
    role_name: "customer",
    active_status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
});

const shop = (overrides) => ({
    shop_id: 1,
    name: "Demo Tech Corner",
    active_status: "active",
    owner_id: 2,
    owner_name: "Demo Vendor",
    owner_email: "vendor@example.test",
    owner_status: "active",
    city: "Dhaka",
    listing_count: 4,
    active_listing_count: 4,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
});

const accounts = [account({}), account({ user_id: 9, name: "Admin", email: "admin@example.test", role_name: "admin" })];
const shops = [shop({}), shop({ shop_id: 2, name: "Demo Gadget House", active_status: "pending", listing_count: 0, active_listing_count: 0 })];

const listing = (overrides) => ({
    prod_id: 11,
    name: "Demo Wireless Keyboard",
    in_stock: 20,
    unit_price: "35.00",
    discontinued: false,
    master_prod_id: 3,
    master_name: "Demo Wireless Keyboard",
    wholesale_price: "25.00",
    refund: {
        units: 20,
        purchased_units: 20,
        fallback_units: 0,
        fallback_unit_amount: "25.00",
        purchased_amount: "500.00",
        fallback_amount: "0.00",
        amount: "500.00",
    },
    ...overrides,
});

const payment = (overrides) => ({
    transaction_id: 3,
    order_id: 4,
    order_status: "delivered",
    customer_name: "Demo Customer",
    customer_email: "customer@example.test",
    amount: "128.00",
    total_amount: "120.00",
    delivery_cost: "8.00",
    payment_method: "cash_on_delivery",
    payment_status: "completed",
    paid_at: "2026-09-03T15:00:00.000Z",
    ...overrides,
});

const refund = (overrides) => ({
    refund_id: 2,
    shop_id: 1,
    shop_name: "Demo Tech Corner",
    listing_name: "Demo Wireless Keyboard",
    master_name: "Demo Wireless Keyboard",
    units: 20,
    unit_amount: "25.00",
    amount: "500.00",
    reason: "admin_removal",
    admin_name: "Admin",
    admin_email: "admin@example.test",
    created_at: "2026-09-20T00:00:00.000Z",
    ...overrides,
});

// Records every admin list request and every status write so a test can assert
// on what the console actually sent.
async function mockApi(
    page,
    {
        user = admin,
        shopRows = shops,
        listingRows = [listing({})],
        paymentRows = [payment({})],
        refundRows = [refund({})],
    } = {},
) {
    const queries = [];
    const writes = [];
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        const method = route.request().method();
        if (path === "/api/auth/me") {
            return route.fulfill({
                status: user ? 200 : 401,
                json: user ? { user } : { message: "Authentication is required." },
            });
        }
        if (path === "/api/admin/users" && method === "GET") {
            queries.push(url.search);
            return route.fulfill({ json: { items: accounts, total: accounts.length, page: 1, limit: 20, total_pages: 1 } });
        }
        if (path === "/api/admin/shops" && method === "GET") {
            queries.push(url.search);
            const status = url.searchParams.get("status");
            const items = status ? shopRows.filter((row) => row.active_status === status) : shopRows;
            return route.fulfill({ json: { items, total: items.length, page: 1, limit: 20, total_pages: 1 } });
        }
        if (/^\/api\/admin\/shops\/\d+\/listings$/.test(path) && method === "GET") {
            queries.push(path);
            return route.fulfill({ json: listingRows });
        }
        if (/^\/api\/admin\/listings\/\d+\/discontinue$/.test(path) && method === "PUT") {
            const prodId = Number(path.split("/")[4]);
            const row = listingRows.find((item) => item.prod_id === prodId);
            writes.push({ path, prodId });
            return route.fulfill({
                json: {
                    message: `Listing removed. $${row.refund.amount} refunded to the vendor.`,
                    refund: { ...row.refund, prod_id: prodId },
                },
            });
        }
        if (path === "/api/admin/payments" && method === "GET") {
            queries.push(url.search);
            const status = url.searchParams.get("status");
            const method = url.searchParams.get("method");
            let items = paymentRows;
            if (status) items = items.filter((row) => row.payment_status === status);
            if (method) items = items.filter((row) => row.payment_method === method);
            return route.fulfill({ json: { items, total: items.length, page: 1, limit: 20, total_pages: 1 } });
        }
        if (path === "/api/admin/refunds" && method === "GET") {
            queries.push(url.search);
            const reason = url.searchParams.get("reason");
            const items = reason ? refundRows.filter((row) => row.reason === reason) : refundRows;
            return route.fulfill({ json: { items, total: items.length, page: 1, limit: 20, total_pages: 1 } });
        }

        if (path.startsWith("/api/admin/shops/") && method === "PUT") {
            const body = route.request().postDataJSON();
            writes.push({ path, body });
            return route.fulfill({
                json: {
                    message: body.active_status === "active" ? "Shop approved and visible to shoppers." : "Shop disabled and its listings discontinued. Re-enabling the shop will not restore them.",
                    shop: { shop_id: Number(path.split("/")[4]), active_status: body.active_status },
                },
            });
        }
        if (path.startsWith("/api/admin/users/") && method === "PUT") {
            const body = route.request().postDataJSON();
            writes.push({ path, body });
            return route.fulfill({ json: { message: "User status updated.", user: { active_status: body.active_status } } });
        }
        return route.fulfill({ status: 404, json: { message: "Route not found." } });
    });
    return { queries, writes };
}

test("the console is closed to anyone who is not an administrator", async ({ page }) => {
    await mockApi(page, { user: { ...admin, role: "customer" } });
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Administration" })).toHaveCount(0);
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
    await mockApi(page, { user: null });
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
});

test("the tab lives in the URL and picks the panel", async ({ page }) => {
    const { queries } = await mockApi(page);
    await page.goto("/admin");

    // Users is the default panel, and it asks the server for a named page size.
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    // Polled: the panel renders before its own request has been sent, so reading
    // the recorded list synchronously is a race the suite loses under load.
    await expect.poll(() => queries[0]).toContain("limit=20");
    await expect(page.locator("table")).toContainText("customer@example.test");

    await page.getByRole("button", { name: "Shops", exact: true }).click();
    await expect(page).toHaveURL(/tab=shops/);
    await expect(page.locator("table")).toContainText("Demo Tech Corner");
    await expect(page.locator("table")).not.toContainText("customer@example.test");

    await page.getByRole("button", { name: "Pending requests", exact: true }).click();
    await expect(page).toHaveURL(/tab=pending/);
    // The queue is the shop list under a fixed filter, not a separate endpoint.
    await expect.poll(() => queries.at(-1)).toContain("status=pending");
    await expect(page.getByRole("heading", { name: "Demo Gadget House" })).toBeVisible();

    // The link to the catalog admin is a tab that leaves the console.
    await expect(page.getByRole("link", { name: "Master catalog" })).toHaveAttribute("href", "/admin/catalog");
});

test("filters reach the server as query parameters", async ({ page }) => {
    const { queries } = await mockApi(page);
    await page.goto("/admin");

    await page.locator(".console-search input").fill("vendor");
    await expect.poll(() => queries.at(-1)).toContain("q=vendor");

    await page.getByLabel("Role").selectOption("vendor");
    await expect.poll(() => queries.at(-1)).toContain("role=vendor");

    await page.getByLabel("Status").selectOption("disabled");
    await expect.poll(() => queries.at(-1)).toContain("status=disabled");

    // A filter that does not apply to the next panel must not be carried over:
    // "pending" is a shop status, and a page number from a longer list would
    // land on an empty page.
    await page.getByRole("button", { name: "Shops", exact: true }).click();
    await expect(page).toHaveURL(/tab=shops/);
    await expect(page).not.toHaveURL(/role=/);
    await expect(page).not.toHaveURL(/status=/);
    // The search term survives, because it means the same thing in both.
    await expect(page).toHaveURL(/q=vendor/);
});

test("Approving a pending shop sends the status change and refreshes the queue", async ({ page }) => {
    const { writes, queries } = await mockApi(page);
    await page.goto("/admin?tab=pending");

    await page.getByRole("button", { name: "Approve" }).click();
    await expect
        .poll(() => writes)
        .toEqual([{ path: "/api/admin/shops/2/status", body: { active_status: "active" } }]);
    await expect(page.getByRole("status")).toHaveText("Shop approved and visible to shoppers.");
    // The panel reloads rather than leaving a shop on screen that is no longer
    // pending.
    await expect.poll(() => queries.at(-1)).toContain("status=pending");
});

test("rejecting is the same endpoint with the other status", async ({ page }) => {
    const { writes } = await mockApi(page);
    await page.goto("/admin?tab=pending");

    await page.getByRole("button", { name: "Reject" }).click();
    await expect
        .poll(() => writes)
        .toEqual([{ path: "/api/admin/shops/2/status", body: { active_status: "disabled" } }]);
    await expect(page.getByRole("status")).toContainText("will not restore them");
});

test("disabling a shop says what it will discontinue before it does it", async ({ page }) => {
    const { writes } = await mockApi(page);
    await page.goto("/admin?tab=shops");

    await page.getByRole("button", { name: "Disable", exact: true }).click();
    // Nothing is sent until the administrator confirms what the ban costs.
    expect(writes).toEqual([]);
    const confirm = page.getByRole("button", { name: "Confirm: discontinue 4 listings" });
    await expect(confirm).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Confirm: discontinue 4 listings" })).toHaveCount(0);
    expect(writes).toEqual([]);

    await page.getByRole("button", { name: "Disable", exact: true }).click();
    await page.getByRole("button", { name: "Confirm: discontinue 4 listings" }).click();
    await expect
        .poll(() => writes)
        .toEqual([{ path: "/api/admin/shops/1/status", body: { active_status: "disabled" } }]);
});

test("the table reports how much of a shop is live", async ({ page }) => {
    await mockApi(page, {
        shopRows: [shop({ listing_count: 7, active_listing_count: 3, owner_status: "disabled" })],
    });
    await page.goto("/admin?tab=shops");
    await expect(page.locator("table")).toContainText("3 of 7 live");
    // A banned owner is called out, because their shops are disabled with them.
    await expect(page.locator("table")).toContainText("(banned)");
});

test("an administrator cannot disable their own account from the console", async ({ page }) => {
    await mockApi(page);
    await page.goto("/admin");

    const ownRow = page.locator("tr", { hasText: "admin@example.test" });
    await expect(ownRow).toContainText("This is you");
    await expect(ownRow.getByRole("button")).toHaveCount(0);

    // Everyone else still has one.
    await expect(page.locator("tr", { hasText: "customer@example.test" }).getByRole("button", { name: "Disable" })).toBeVisible();
});

test("a failed list reports the server message instead of reading as empty", async ({ page }) => {
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/me") return route.fulfill({ json: { user: admin } });
        return route.fulfill({ status: 500, json: { message: "Could not load the accounts." } });
    });
    await page.goto("/admin");
    await expect(page.getByRole("alert")).toContainText("Could not load the accounts.");
    await expect(page.locator(".empty-state")).toHaveCount(0);
});

test("a shop opens into its listings without loading the other shops'", async ({ page }) => {
    const { queries } = await mockApi(page);
    await page.goto("/admin?tab=shops");

    // Nothing is fetched until a shop is opened.
    expect(queries.filter((entry) => entry.includes("/listings"))).toEqual([]);

    await page.getByRole("button", { name: "4 of 4 live" }).first().click();
    // StrictMode fetches an effect twice in development, so this asserts which
    // shop was asked for rather than how many times.
    await expect
        .poll(() => queries.filter((entry) => entry.includes("/listings")).at(-1))
        .toBe("/api/admin/shops/1/listings");
    expect(queries.some((entry) => entry.includes("/shops/2/listings"))).toBe(false);

    const expansion = page.locator(".console-listings");
    await expect(expansion).toContainText("Demo Wireless Keyboard");
    await expect(expansion).toContainText("$500.00 for 20 units");
    await expect(expansion).toContainText("$35.00");

    // The count is the handle for the list, so clicking it again closes it.
    await page.getByRole("button", { name: "4 of 4 live" }).first().click();
    await expect(page.locator(".console-listings")).toHaveCount(0);
});

test("removing a listing says what it will pay before it pays it", async ({ page }) => {
    const { writes } = await mockApi(page);
    await page.goto("/admin?tab=shops");
    await page.getByRole("button", { name: "4 of 4 live" }).first().click();

    await page.getByRole("button", { name: "Remove and refund" }).click();
    // A single slip must not move money: nothing is sent until the confirm click,
    // and the confirm click names the amount.
    expect(writes).toEqual([]);
    const confirm = page.getByRole("button", { name: "Confirm: remove and refund $500.00" });
    await expect(confirm).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    expect(writes).toEqual([]);

    await page.getByRole("button", { name: "Remove and refund" }).click();
    await page.getByRole("button", { name: "Confirm: remove and refund $500.00" }).click();
    await expect
        .poll(() => writes)
        .toEqual([{ path: "/api/admin/listings/11/discontinue", prodId: 11 }]);
    await expect(page.getByRole("status")).toContainText("$500.00 refunded to the vendor");
});

test("a retired listing offers no removal button, and says why there is nothing to pay", async ({ page }) => {
    await mockApi(page, {
        listingRows: [
            listing({ prod_id: 12, name: "Demo Desk Lamp", discontinued: true, in_stock: 0, refund: null }),
        ],
    });
    await page.goto("/admin?tab=shops");
    await page.getByRole("button", { name: "4 of 4 live" }).first().click();

    const row = page.locator(".console-listings tbody tr", { hasText: "Demo Desk Lamp" });
    await expect(row).toContainText("Retired");
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(row).toContainText("Nothing to refund");
});

test("the payments tab shows the platform's cut beside the customer's bill", async ({ page }) => {
    const { queries } = await mockApi(page);
    // Arrived from the shop queue, which has its own meaning for `status`. The
    // two must not be confused: "pending" is a shop state, and payments would
    // read it as a payment state and quietly return nothing.
    await page.goto("/admin?tab=shops&status=pending");

    await page.getByRole("button", { name: "Payments", exact: true }).click();
    await expect(page).toHaveURL(/tab=payments/);
    await expect(page).not.toHaveURL(/status=/);

    const table = page.locator("table");
    await expect(table).toContainText("customer@example.test");
    // The order total and the trip are different numbers, and the row has to show
    // both or the screen is misleading: their sum is what the customer pays.
    await expect(table).toContainText("$128.00");
    await expect(table).toContainText("$120.00 + $8.00 delivery");
    await expect(table).toContainText("Cash on delivery");
    await expect(table).not.toContainText("Commission");

    await expect.poll(() => queries.at(-1)).toContain("limit=20");
    await page.getByLabel("Method").selectOption("prepaid");
    await expect.poll(() => queries.at(-1)).toContain("method=prepaid");
});

test("a completed payment is a status, and a failed one is not read as settled", async ({ page }) => {
    await mockApi(page, {
        paymentRows: [
            payment({ transaction_id: 1, order_id: 1, order_status: "cancelled", payment_status: "failed", paid_at: null }),
        ],
    });
    await page.goto("/admin?tab=payments&status=failed");

    const row = page.locator("table tbody tr").first();
    await expect(row).toContainText("#1");
    await expect(row.locator(".status-pill", { hasText: "failed" })).toBeVisible();
    await expect(row.locator(".status-pill", { hasText: "cancelled" })).toBeVisible();
    // Never settled, so the column says so rather than dating it.
    await expect(row).toContainText("—");
});

test("the refunds tab names who was paid and who decided to", async ({ page }) => {
    const { queries } = await mockApi(page);
    await page.goto("/admin?tab=refunds");

    const table = page.locator("table");
    await expect(table).toContainText("Demo Tech Corner");
    await expect(table).toContainText("Demo Wireless Keyboard");
    await expect(table).toContainText("20");
    await expect(table).toContainText("$25.00");
    await expect(table).toContainText("$500.00");
    await expect(table).toContainText("Admin removal");
    await expect(table).toContainText("admin@example.test");

    // The reason is a closed set the server accepts, not free text, so the
    // select offers exactly those two.
    await page.getByLabel("Reason").selectOption("shop_closed");
    await expect.poll(() => queries.at(-1)).toContain("reason=shop_closed");
});

test("an empty refunds list explains what would fill it", async ({ page }) => {
    await mockApi(page, { refundRows: [] });
    await page.goto("/admin?tab=refunds");
    await expect(page.locator(".empty-state")).toContainText("Removing a listing or a master product");
    await expect(page.locator("table")).toHaveCount(0);
});
