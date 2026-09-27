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
    shops: [{ shop_id: 1, name: "Demo Tech Corner", active_status: "active", balance: "500.00" }],
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
        refunds_received: "500.00",
        balance_total: "500.00",
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
        refunds_received: "0.00",
        balance_total: "0.00",
    },
};

// A return waiting for the vendor's decision, one already accepted and in the
// courier's hands, and the two answers the flow has already given.
const openReturn = {
    return_id: 9,
    order_id: 4,
    prod_id: 11,
    shop_id: 1,
    quantity: 1,
    reason: "It arrived scratched.",
    status: "requested",
    refund_amount: "35.00",
    decision_note: null,
    decided_at: null,
    collected_at: null,
    restocked_at: null,
    created_at: "2026-09-20T00:00:00.000Z",
    listing_name: "Demo Wireless Keyboard",
    shop_name: "Demo Tech Corner",
    customer_name: "Demo Customer",
    collected_by_name: null,
};

const collectedReturn = {
    ...openReturn,
    return_id: 10,
    prod_id: 12,
    listing_name: "Demo Fitness Watch",
    status: "collected",
    decision_note: "Sorry about that.",
    refund_amount: "45.00",
    collected_by_name: "Demo Courier",
    collected_at: "2026-09-22T00:00:00.000Z",
};

const settledReturn = {
    ...openReturn,
    return_id: 11,
    status: "rejected",
    decision_note: "Outside the return window.",
    decided_at: "2026-09-21T00:00:00.000Z",
};

// The customer's own view of the same return, and the courier's pickup list. The
// pickup carries the delivery address, which the courier needs and the return
// itself does not store.
const customerReturns = [openReturn];
const courierReturns = [
    {
        ...openReturn,
        return_id: 12,
        status: "approved",
        street_address: "1 Test Street",
        city: "Testville",
        state_province: "TS",
        postal_code: "1000",
        customer_phone: "+8801000000000",
    },
];

// Two months of takings with one refund in the second, so the chart has a period
// with a refund bar and a period without.
const statistics = {
    group_by: "month",
    series: [
        { period: "2026-08-01", units: 3, orders: 2, revenue: "80.00", refunds: "0.00" },
        { period: "2026-09-01", units: 2, orders: 1, revenue: "120.00", refunds: "20.00" },
    ],
    top_listings: [
        {
            prod_id: 11,
            listing_name: "Demo Wireless Keyboard",
            shop_name: "Demo Tech Corner",
            units: 4,
            revenue: "140.00",
        },
    ],
    totals: {
        delivered_revenue: "200.00",
        units_sold: 5,
        delivered_orders: 3,
        recharged: "500.00",
        wholesale_spend: "500.00",
        refunded_to_customers: "20.00",
        refunds_received: "0.00",
        balance_total: "180.00",
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
        vendorReturns = [],
        vendorStatistics = statistics,
        customerReturns: customerReturnRows = customerReturns,
        courierReturns: courierReturnRows = courierReturns,
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
        requests.push(`${method} ${path}${url.search}`);

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
        if (path === "/api/vendor/returns") return route.fulfill({ json: vendorReturns });
        if (path === "/api/vendor/statistics") {
            return route.fulfill({ json: vendorStatistics });
        }
        if (path === "/api/vendor/balance") {
            return route.fulfill({
                json: {
                    shop_id: 1,
                    name: "Demo Tech Corner",
                    balance: vendorBooks.totals.balance_total,
                    movements: [],
                },
            });
        }
        // The three return transitions the vendor owns, and the courier's one.
        // A restock or a collection sends no body at all, so the payload is read
        // defensively rather than assumed.
        if (/^\/api\/(vendor|delivery)\/returns\/\d+\/(approve|reject|restock|collect)$/.test(path)) {
            const raw = route.request().postData();
            onWrite?.({ method, path, body: raw ? JSON.parse(raw) : null });
            return route.fulfill({ json: { message: "Done." } });
        }
        if (path === "/api/returns") {
            if (method === "POST") {
                onWrite?.({
                    method,
                    path,
                    body: route.request().postDataJSON(),
                });
                return route.fulfill({
                    status: 201,
                    json: { message: "Asked the shop to review it.", return: openReturn },
                });
            }
            return route.fulfill({ json: customerReturnRows });
        }
        if (path === "/api/delivery/returns") {
            return route.fulfill({ json: courierReturnRows });
        }
        // The courier page also carries the open board and the courier's own run.
        // Both are empty here: these tests are about the pickups, and the board's
        // accept flow has its own test in checkout.spec.js. Answering them keeps
        // the page from rendering "route not found" where a real page has content.
        if (path === "/api/delivery/open-orders" || path === "/api/delivery/deliveries") {
            return route.fulfill({ json: [] });
        }
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

    // The buyer sees the two halves of their own money and nothing else. There is
    // no third party's cut to hide, so the check is that no such column exists.
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
    await expect(balance).not.toContainText("commission");

    // Three tables, told apart by what only they contain: the sale is the only
    // row carrying an order number, and the purchase is the only one whose shop
    // and product sit in one cell.
    const sale = page.locator("table tbody tr", { hasText: "#4" });
    await expect(sale).toContainText("Demo Wireless Keyboard");
    await expect(sale).toContainText("$35.00");
    await expect(sale).toContainText("$70.00");
    await expect(sale.locator(".status-pill")).toHaveText("delivered");

    const purchase = page.locator("table tbody tr", { hasText: "Demo Tech Corner / Demo Wireless Keyboard" });
    await expect(purchase).toContainText("20");
    await expect(purchase).toContainText("$25.00");
    await expect(purchase).toContainText("$500.00");

    const refund = page.locator("table tbody tr", { hasText: "Removed by an administrator" });
    await expect(refund).toContainText("#2");
    await expect(refund).toContainText("$500.00");
});

test("a vendor who has sold nothing gets explanations rather than empty tables", async ({ page }) => {
    await mockApi(page, { user: vendor, vendorBooks: emptyBooks });
    await page.goto("/vendor/payments");

    // Four: the three lists, plus the return queue, which is empty for the same
    // reason — nothing has been sold, so nothing can come back.
    await expect(page.locator(".empty-state")).toHaveCount(4);
    await expect(page.locator("body")).toContainText("Nothing has sold yet");
    await expect(page.locator("body")).toContainText("You have not bought any stock yet");
    await expect(page.locator("body")).toContainText("nothing to refund");
    await expect(page.locator("body")).toContainText("Nothing is waiting for a decision");
    await expect(page.locator("table")).toHaveCount(0);
});

test("a vendor decides a return, and cannot decline it silently", async ({ page }) => {
    const writes = [];
    await mockApi(page, {
        user: vendor,
        vendorReturns: [openReturn, collectedReturn, settledReturn],
        onWrite: (write) => writes.push(write),
    });
    await page.goto("/vendor/payments");

    // The decision queue. The amount is on the button, because accepting is what
    // moves the money and the vendor should see the figure they are agreeing to.
    const waiting = page.locator("article.panel", { hasText: "It arrived scratched." });
    await expect(waiting).toContainText("Demo Customer");
    await expect(waiting.getByRole("button", { name: "Accept and refund $35.00" })).toBeVisible();

    // A refusal needs a reason: the customer reads it, and the server refuses a
    // blank one too, so the button stays dead until something is typed.
    const decline = waiting.getByRole("button", { name: "Decline" });
    await expect(decline).toBeDisabled();
    await waiting.getByLabel("Note to the customer").fill("Outside the return window.");
    await expect(decline).toBeEnabled();
    await decline.click();
    await expect.poll(() => writes).toEqual([
        {
            method: "PUT",
            path: "/api/vendor/returns/9/reject",
            body: { decision_note: "Outside the return window." },
        },
    ]);

    // Restocking waits for the parcel. The refund was paid on acceptance, so the
    // button is dead until a courier has collected it.
    const inTransit = page.locator("table tbody tr", { hasText: "Demo Fitness Watch" });
    await expect(inTransit).toContainText("Demo Courier");
    await expect(inTransit.getByRole("button", { name: "Mark back in stock" })).toBeEnabled();
    await inTransit.getByRole("button", { name: "Mark back in stock" }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1].path).toBe("/api/vendor/returns/10/restock");

    // The two answers already given are kept, with the note that came with them.
    const history = page.locator("table tbody tr", { hasText: "Outside the return window." });
    await expect(history).toContainText("rejected");
});

test("a customer asks to return a delivered line, and the shop's answer comes back", async ({ page }) => {
    const writes = [];
    await mockApi(page, {
        customerReturns: [settledReturn],
        onWrite: (write) => writes.push(write),
    });
    await page.goto("/orders/7");

    // The refusal is on the page, with its reason: a request that vanished would
    // leave the customer unable to tell whether it had been seen. The panel is
    // scoped by its heading because the order's own item table carries the same
    // listing name.
    const returns = page.locator("section.panel").filter({
        has: page.getByRole("heading", { name: "Returns", level: 2 }),
    });
    const answered = returns.locator("tbody tr");
    await expect(answered).toContainText("rejected");
    await expect(answered).toContainText("Outside the return window.");

    // The other line has no open return, so it can still be asked about.
    await page.getByRole("button", { name: "Return an item" }).click();
    const form = page.locator("form", { hasText: "Ask to return it" });
    await expect(form.getByLabel("Item")).not.toContainText("Demo Wireless Keyboard");
    await form.getByLabel("How many units").fill("1");
    await form.getByLabel("Why").fill("It arrived scratched.");
    await form.getByRole("button", { name: "Ask to return it" }).click();

    await expect.poll(() => writes).toEqual([
        {
            method: "POST",
            path: "/api/returns",
            body: {
                prod_id: "12",
                quantity: "1",
                reason: "It arrived scratched.",
                order_id: 7,
            },
        },
    ]);
});

test("an order still on its way offers no return form", async ({ page }) => {
    await mockApi(page, { customerReturns: [] });
    // Registered after the catch-all above, so this is the route that answers.
    await page.route("**/api/orders/7", (route) =>
        route.fulfill({ json: { ...order, order_status: "shipped" } }),
    );
    await page.goto("/orders/7");

    await expect(page.getByRole("button", { name: "Return an item" })).toHaveCount(0);
    await expect(page.locator("body")).toContainText("once the order has been delivered");
});

test("a courier sees the pickups nobody has collected, and can take one", async ({ page }) => {
    const writes = [];
    await mockApi(page, { user: courier, onWrite: (write) => writes.push(write) });
    await page.goto("/delivery/deliveries");

    await expect(page.getByRole("heading", { name: "Returns to collect" })).toBeVisible();
    const pickup = page.locator(".order-card", { hasText: "Demo Wireless Keyboard" });
    await expect(pickup).toContainText("Demo Tech Corner");
    await expect(pickup).toContainText("1 Test Street");
    // The customer has already been paid back, so nobody collects cash at the door.
    await expect(pickup).toContainText("already been refunded");

    await pickup.getByRole("button", { name: "Mark collected" }).click();
    await expect.poll(() => writes).toEqual([
        { method: "PUT", path: "/api/delivery/returns/12/collect", body: null },
    ]);
});

test("the income page charts what was delivered and reconciles to the balance", async ({ page }) => {
    const { requests } = await mockApi(page, { user: vendor });
    await page.goto("/vendor/statistics");

    await expect.poll(() => requests.includes("GET /api/vendor/statistics?group_by=month")).toBe(true);
    await expect(page.getByRole("heading", { name: "Income", level: 1 })).toBeVisible();

    // One revenue bar per period; a refund bar only for the period that had one,
    // so an absent bar means no refunds rather than a missing series.
    await expect(page.locator(".chart-bar-revenue")).toHaveCount(2);
    await expect(page.locator(".chart-bar-refund")).toHaveCount(1);
    await expect(page.locator(".chart-legend")).toContainText("Delivered revenue");
    await expect(page.locator(".chart-legend")).toContainText("Refunded to customers");

    // The headline arithmetic: revenue, refunds, and what is left of it.
    const facts = page.locator(".order-facts");
    await expect(facts).toContainText("$200.00");
    await expect(facts).toContainText("$20.00");
    await expect(facts).toContainText("$180.00");
    await expect(facts).toContainText("$500.00");

    // The leaderboard shares out the same revenue, and says what share.
    const best = page.locator("table tbody tr", { hasText: "Demo Wireless Keyboard" });
    await expect(best).toContainText("$140.00");
    await expect(best).toContainText("70.0%");

    // Every period is listed too, including the one with nothing refunded.
    await expect(page.locator("table tbody tr", { hasText: "2026-08-01" })).toContainText("$80.00");

    // A finer bucket is a different request, not a client-side regrouping.
    await page.getByLabel("Group by").selectOption("week");
    await expect.poll(() => requests.includes("GET /api/vendor/statistics?group_by=week")).toBe(true);
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
