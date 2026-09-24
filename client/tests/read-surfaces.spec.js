import { test, expect } from "@playwright/test";

// The read surfaces that were added so the tables nobody could reach finally have
// a reader: the customer's own payments, the vendor's books, and the shop review
// form on an order.
//
// These drive the real client against controlled responses, so what is being
// checked is the wiring the server tests cannot see — which request a screen
// makes, what it does with an empty answer, and who is allowed to open it at all.

const customer = {
    user_id: 1,
    name: "Demo Customer",
    email: "customer@example.test",
    role: "customer",
};
const vendor = { user_id: 2, name: "Demo Vendor", email: "vendor@example.test", role: "vendor" };

const payment = (overrides) => ({
    transaction_id: 3,
    order_id: 4,
    order_status: "delivered",
    created_at: "2026-09-01T10:00:00.000Z",
    total_amount: "120.00",
    delivery_cost: "8.00",
    amount: "128.00",
    payment_method: "cash_on_delivery",
    payment_status: "completed",
    paid_at: "2026-09-03T15:00:00.000Z",
    ...overrides,
});

const books = {
    shops: [{ shop_id: 1, name: "Demo Tech Corner", active_status: "active", earnings: "500.00" }],
    sales: [
        {
            order_id: 4,
            prod_id: 11,
            listing_name: "Demo Wireless Keyboard",
            shop_name: "Demo Tech Corner",
            shop_id: 1,
            quantity: 2,
            unit_price: "35.00",
            subtotal: "70.00",
            platform_commission: "3.50",
            net_to_shop: "66.50",
            order_status: "delivered",
            created_at: "2026-09-01T10:00:00.000Z",
        },
    ],
    purchases: [
        {
            purchase_id: 8,
            shop_name: "Demo Tech Corner",
            name: "Demo Wireless Keyboard",
            quantity: 20,
            wholesale_unit_price: "25.00",
            total: "500.00",
            purchased_at: "2026-08-01T00:00:00.000Z",
        },
    ],
    refunds: [
        {
            refund_id: 2,
            listing_name: "Demo Wireless Keyboard",
            shop_name: "Demo Tech Corner",
            units: 20,
            unit_amount: "25.00",
            amount: "500.00",
            reason: "admin_removal",
            created_at: "2026-09-20T00:00:00.000Z",
        },
    ],
    totals: {
        wholesale_spend: "500.00",
        gross_sales: "70.00",
        commission_paid: "3.50",
        net_sales: "66.50",
        refunds_received: "500.00",
        earnings_balance: "500.00",
    },
};

const emptyBooks = {
    shops: [],
    sales: [],
    purchases: [],
    refunds: [],
    totals: {
        wholesale_spend: "0.00",
        gross_sales: "0.00",
        commission_paid: "0.00",
        net_sales: "0.00",
        refunds_received: "0.00",
        earnings_balance: "0.00",
    },
};

// Two lines from two shops, which is what makes the review panels plural: a
// review is about a seller, not about a listing.
const order = {
    order_id: 7,
    order_status: "delivered",
    total_amount: "70.00",
    delivery_cost: "8.00",
    created_at: "2026-09-01T10:00:00.000Z",
    delivered_at: "2026-09-03T15:00:00.000Z",
    street_address: "1 Test Street",
    city: "Testville",
    state_province: "TS",
    postal_code: "1000",
    delivery_person_name: "Demo Courier",
    payment_status: "completed",
    payment_amount: "78.00",
    paid_at: "2026-09-03T15:00:00.000Z",
    items: [
        {
            prod_id: 11,
            shop_id: 1,
            name: "Demo Wireless Keyboard",
            shop_name: "Demo Tech Corner",
            quantity: 2,
            unit_price: "35.00",
            subtotal: "70.00",
        },
        {
            prod_id: 12,
            shop_id: 2,
            name: "Demo Fitness Watch",
            shop_name: "Demo Gadget House",
            quantity: 1,
            unit_price: "45.00",
            subtotal: "45.00",
        },
    ],
};

const existingReview = {
    user_id: 1,
    rating: 5,
    review: "Careful packaging.",
    last_modified: "2026-09-10T00:00:00.000Z",
};

async function mockApi(
    page,
    {
        user = customer,
        payments = [payment({})],
        vendorBooks = books,
        eligibility = { eligible: true, review: null },
        shopReviewRows = [existingReview],
        onWrite,
    } = {},
) {
    const requests = [];
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        const method = route.request().method();
        requests.push(`${method} ${path}`);

        if (path === "/api/auth/me") {
            return route.fulfill({
                status: user ? 200 : 401,
                json: user ? { user } : { message: "Authentication is required." },
            });
        }
        if (path === "/api/account/payments") {
            return route.fulfill({ json: payments });
        }
        if (path === "/api/vendor/payments") {
            return route.fulfill({ json: vendorBooks });
        }
        // The vendor page fetches these on load whatever tab it is showing, so
        // they have to answer even for the tests that never look at them.
        if (path === "/api/vendor/shops") return route.fulfill({ json: vendorBooks.shops });
        if (path === "/api/vendor/master-products") return route.fulfill({ json: [] });
        if (path === "/api/vendor/listings") return route.fulfill({ json: [] });
        if (path === "/api/vendor/purchases") return route.fulfill({ json: vendorBooks.purchases });
        if (path === "/api/orders/7") return route.fulfill({ json: order });
        if (/^\/api\/shops\/\d+\/reviews$/.test(path)) {
            return route.fulfill({ json: shopReviewRows });
        }
        if (/^\/api\/shops\/\d+\/review-eligibility$/.test(path)) {
            return route.fulfill({ json: eligibility });
        }
        if (/^\/api\/shops\/\d+\/review$/.test(path)) {
            const body = method === "PUT" ? route.request().postDataJSON() : null;
            onWrite?.({ method, path, body });
            return route.fulfill({
                json: {
                    message: method === "PUT" ? "Review saved." : "Review removed.",
                    review: body ? { ...body, user_id: 1, last_modified: "2026-09-21T00:00:00.000Z" } : null,
                },
            });
        }
        return route.fulfill({ status: 404, json: { message: "Route not found." } });
    });
    return { requests };
}

test("the payment history is the customer's own, and has no platform figures on it", async ({ page }) => {
    await mockApi(page);
    await page.goto("/account/payments");

    await expect(page.getByRole("heading", { name: "Payment history" })).toBeVisible();
    const table = page.locator("table");
    await expect(table).toContainText("$120.00");
    await expect(table).toContainText("$8.00");
    await expect(table).toContainText("$128.00");
    await expect(table).toContainText("Cash on delivery");
    await expect(table.locator(".status-pill")).toHaveText("completed");

    // The commission and the vendor's share are not the buyer's business, and the
    // server does not send them — so there is no column to empty.
    await expect(page.locator("thead")).not.toContainText("Commission");
    await expect(page.locator("body")).not.toContainText("net to");

    // A payment is worth nothing here without the way back to what it settles.
    await expect(page.getByRole("link", { name: "Order #4" })).toHaveAttribute("href", "/orders/4");
    await expect(page.locator("body")).toContainText("$128.00 settled in cash");
});

test("a payment that has not settled is not dated, and is not counted as settled", async ({ page }) => {
    await mockApi(page, {
        payments: [payment({ transaction_id: 4, payment_status: "pending", paid_at: null, amount: "50.00" })],
    });
    await page.goto("/account/payments");

    const row = page.locator("table tbody tr").first();
    await expect(row).toContainText("Not yet");
    await expect(page.locator("body")).toContainText("$0.00 settled in cash");
});

test("an empty history offers a way out of it rather than a blank table", async ({ page }) => {
    await mockApi(page, { payments: [] });
    await page.goto("/account/payments");

    await expect(page.locator(".empty-state")).toContainText("You have no payments yet");
    await expect(page.locator("table")).toHaveCount(0);
});

test("the payment history is closed to a vendor", async ({ page }) => {
    await mockApi(page, { user: vendor });
    await page.goto("/account/payments");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Payment history" })).toHaveCount(0);
});

test("a vendor's books read every figure from the server's own totals", async ({ page }) => {
    const { requests } = await mockApi(page, { user: vendor });
    await page.goto("/vendor/payments");

    await expect(page.getByRole("heading", { name: "Payments", level: 1 })).toBeVisible();
    await expect.poll(() => requests.includes("GET /api/vendor/payments")).toBe(true);

    // The headline is the server's number, not the sum of whatever the table
    // happens to be showing.
    const balance = page.locator(".order-facts");
    await expect(balance).toContainText("$500.00");
    await expect(balance).toContainText("$70.00");
    await expect(balance).toContainText("$3.50 platform commission");
    await expect(balance).toContainText("$66.50 net");

    // Three tables, told apart by what only they contain: the sale is the only
    // row carrying an order number, and the purchase is the only one whose shop
    // and product sit in one cell.
    const sale = page.locator("table tbody tr", { hasText: "#4" });
    await expect(sale).toContainText("Demo Wireless Keyboard");
    await expect(sale).toContainText("$35.00");
    await expect(sale).toContainText("$70.00");
    await expect(sale).toContainText("$66.50");
    await expect(sale.locator(".status-pill")).toHaveText("delivered");

    const purchase = page.locator("table tbody tr", { hasText: "Demo Tech Corner / Demo Wireless Keyboard" });
    await expect(purchase).toContainText("20");
    await expect(purchase).toContainText("$25.00");
    await expect(purchase).toContainText("$500.00");

    const refund = page.locator("table tbody tr", { hasText: "Removed by an administrator" });
    await expect(refund).toContainText("#2");
    await expect(refund).toContainText("$500.00");
});

test("a vendor who has sold nothing gets three explanations rather than three empty tables", async ({ page }) => {
    await mockApi(page, { user: vendor, vendorBooks: emptyBooks });
    await page.goto("/vendor/payments");

    await expect(page.locator(".empty-state")).toHaveCount(3);
    await expect(page.locator("body")).toContainText("Nothing has sold yet");
    await expect(page.locator("body")).toContainText("You have not bought any stock yet");
    await expect(page.locator("body")).toContainText("nothing to refund");
    await expect(page.locator("table")).toHaveCount(0);
});

test("an order offers one review form per shop it bought from", async ({ page }) => {
    const writes = [];
    await mockApi(page, { onWrite: (write) => writes.push(write) });
    await page.goto("/orders/7");

    // One panel per seller: two lines from two shops are two reviews to write.
    await expect(page.getByRole("heading", { name: "Demo Tech Corner", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Demo Gadget House", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rate this shop" })).toHaveCount(2);

    // The rating is a real radio group, so it submits with the form. It is
    // driven the way a person drives it — by clicking the third star — rather
    // than by checking a radio that is deliberately hidden from the pointer.
    const form = page.locator(".review-form").first();
    await form.locator(".star-rating .star").nth(2).click();
    await expect(form.getByRole("radio", { name: "3 stars" })).toBeChecked();
    await expect(form.locator(".star-rating-value")).toHaveText("3 out of 5");

    await form.getByLabel("Review").fill("Fast and well packed.");
    await form.getByRole("button", { name: "Post review" }).click();

    await expect.poll(() => writes).toEqual([
        { method: "PUT", path: "/api/shops/1/review", body: { rating: "3", review: "Fast and well packed." } },
    ]);
});

test("a customer with nothing delivered is told why there is no form", async ({ page }) => {
    await mockApi(page, { eligibility: { eligible: false, review: null } });
    await page.goto("/orders/7");

    await expect(page.locator(".review-form")).toHaveCount(0);
    await expect(page.locator("body")).toContainText("once an order from it has been delivered");
});

test("an existing review opens as an update, and can be deleted", async ({ page }) => {
    const writes = [];
    await mockApi(page, {
        eligibility: { eligible: true, review: existingReview },
        onWrite: (write) => writes.push(write),
    });
    await page.goto("/orders/7");

    const form = page.locator(".review-form").first();
    await expect(form.getByRole("heading", { name: "Update your review" })).toBeVisible();
    // The previous rating and text are the starting point, not a blank form.
    await expect(form.getByLabel("Review")).toHaveValue("Careful packaging.");
    await expect(form.getByRole("radio", { name: "5 stars" })).toBeChecked();

    await form.getByRole("button", { name: "Delete review" }).click();
    await expect.poll(() => writes).toEqual([{ method: "DELETE", path: "/api/shops/1/review", body: null }]);
});
