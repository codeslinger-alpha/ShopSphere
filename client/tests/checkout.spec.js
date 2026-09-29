import { test, expect } from "@playwright/test";

// The checkout, order history and courier run, driven entirely through mocked
// API responses. What is being checked here is the client's half of the
// contract: that it reads the cart as the order, sends exactly one placement
// request, and shows whatever the server says when that request is refused —
// including the stock message the whole concurrency design exists to produce.
const customer = {
  user_id: 1,
  name: "Customer",
  email: "customer@example.test",
  role: "customer",
};
const item = {
  prod_id: 1,
  name: "Keyboard",
  shop_name: "Shop",
  unit_price: "10.00",
  subtotal: "20.00",
  quantity: 2,
  in_stock: 5,
  available: true,
};
const order = {
  order_id: 7,
  order_status: "pending",
  total_amount: "20.00",
  delivery_cost: "0.00",
  created_at: "2026-01-01T10:00:00.000Z",
  delivered_at: null,
  street_address: "1 Test Street",
  city: "Testville",
  state_province: "TS",
  postal_code: "1000",
  payment_status: "pending",
  payment_method: "cash_on_delivery",
  payment_amount: "20.00",
  paid_at: null,
  delivery_person_name: null,
  item_count: 1,
  item_quantity: 2,
};
const orderItems = [
  {
    prod_id: 1,
    shop_id: 1,
    name: "Keyboard",
    shop_name: "Shop",
    quantity: 2,
    unit_price: "10.00",
    subtotal: "20.00",
  },
];

async function mockApi(page, currentUser = customer, cart = [item]) {
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me")
        return currentUser
          ? route.fulfill({ json: { user: currentUser } })
          : route.fulfill({
              status: 401,
              json: { message: "Authentication is required." },
            });
      if (path === "/api/cart") return route.fulfill({ json: cart });
      if (path === "/api/profile")
        return route.fulfill({
          json: {
            user_id: currentUser.user_id,
            street_address: "1 Test Street",
            city: "Testville",
          },
        });
      if (path === "/api/orders/7")
        return route.fulfill({ json: { ...order, items: orderItems } });
      if (path === "/api/orders") return route.fulfill({ json: [] });
      if (path === "/api/countries")
        return route.fulfill({
          json: [{ country_id: "BD", country_name: "Bangladesh" }],
        });
      if (path === "/api/categories") return route.fulfill({ json: [] });
      // The order detail offers a review per shop it bought from. These orders
      // are not delivered, so the server says the customer is not eligible yet —
      // which is the answer that leaves no form on the page.
      if (/^\/api\/shops\/\d+\/reviews$/.test(path))
        return route.fulfill({ json: [] });
      if (/^\/api\/shops\/\d+\/review-eligibility$/.test(path))
        return route.fulfill({ json: { eligible: false, review: null } });
      return route.fulfill({
        status: 404,
        json: { message: "Route not found." },
      });
    },
  );
}

test("checkout reads the order off the cart and asks for cash on delivery", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  await expect(page.locator(".checkout-lines")).toContainText("Keyboard");
  await expect(page.locator(".cart-total")).toHaveText("Total: $20.00");
  await expect(
    page.getByRole("button", { name: "Place order (cash on delivery)" }),
  ).toBeVisible();
});

test("placing the order posts once and shows the order it created", async ({
  page,
}) => {
  await mockApi(page);
  let posts = 0;
  await page.route("**/api/orders", (route) => {
    posts++;
    // No address was entered, so the server is told to use the profile's. An
    // empty body is the instruction, not a missing one.
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({
      status: 201,
      json: { message: "Order placed.", order: { ...order, items: orderItems } },
    });
  });

  await page.goto("/checkout");
  await page
    .getByRole("button", { name: "Place order (cash on delivery)" })
    .click();

  await expect(page).toHaveURL(/\/orders\/7$/);
  await expect(page.getByRole("heading", { name: "Order #7" })).toBeVisible();
  await expect(page.locator(".notice")).toContainText(
    "Keep $20.00 ready in cash",
  );
  expect(posts).toBe(1);
});

test("an address entered at checkout is sent instead of the profile's", async ({
  page,
}) => {
  await mockApi(page);
  let body;
  await page.route("**/api/orders", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      json: { message: "Order placed.", order: { ...order, items: orderItems } },
    });
  });

  await page.goto("/checkout");
  await page
    .getByRole("checkbox", { name: "Send this order to a different address" })
    .check();
  await page.getByLabel("Street address").fill("9 Elsewhere Road");
  await page.getByLabel("City").fill("Othertown");
  await page.getByLabel("Country").selectOption("BD");
  await page
    .getByRole("button", { name: "Place order (cash on delivery)" })
    .click();

  await expect(page).toHaveURL(/\/orders\/7$/);
  expect(body.street_address).toBe("9 Elsewhere Road");
  expect(body.city).toBe("Othertown");
});

test("a listing that sells out mid-checkout surfaces the server's message", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/orders", (route) =>
    route.fulfill({
      status: 409,
      json: {
        message:
          '"Keyboard" sold out while you were checking out — none left at Shop. Adjust your cart and try again.',
      },
    }),
  );

  await page.goto("/checkout");
  await page
    .getByRole("button", { name: "Place order (cash on delivery)" })
    .click();

  // The refusal names the listing: an empty page or a bare "conflict" would
  // leave the customer with nothing to act on.
  await expect(page.getByRole("alert")).toContainText('"Keyboard" sold out');
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(
    page.getByRole("button", { name: "Place order (cash on delivery)" }),
  ).toBeEnabled();
});

test("a short line stops the cart from offering checkout", async ({ page }) => {
  await mockApi(page, customer, [{ ...item, in_stock: 1 }]);
  await page.goto("/cart");
  await expect(
    page.getByText("Some items are unavailable or exceed the stock."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Proceed to checkout" }),
  ).toBeDisabled();
});

test("an order can be cancelled while it is still pending, and not after", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/orders/7/cancel", (route) =>
    route.fulfill({
      json: { message: "Order cancelled.", order: { order_status: "cancelled" } },
    }),
  );

  await page.goto("/orders/7");
  await expect(
    page.getByRole("button", { name: "Cancel order" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel order" }).click();
  // Scoped to the notice: the reload that follows cancels puts a second
  // role="status" element on the page ("Loading the order...").
  await expect(page.locator(".notice")).toContainText("Order cancelled.");
});

test("a delivered order offers no cancel button", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/orders/7", (route) =>
    route.fulfill({
      json: {
        ...order,
        order_status: "delivered",
        payment_status: "completed",
        paid_at: "2026-01-02T10:00:00.000Z",
        items: orderItems,
      },
    }),
  );

  await page.goto("/orders/7");
  await expect(page.locator(".status-pill.status-delivered")).toHaveText(
    "Delivered",
  );
  await expect(page.locator(".status-pill.status-completed")).toHaveText(
    "Paid in cash",
  );
  await expect(
    page.getByRole("button", { name: "Cancel order" }),
  ).toHaveCount(0);
  // Settled in cash, and the order detail says so in prose as well as in the
  // pill — the pill alone would not tell the customer when it was paid. The
  // sentence is located rather than the panel, because the order page has gained
  // panels since this was written and "the last one" is no longer the payment's.
  await expect(page.locator("p.muted", { hasText: "Paid in cash on" })).toBeVisible();
});

test("checkout and orders are closed to other roles, and to guests", async ({
  page,
}) => {
  await mockApi(page, {
    user_id: 9,
    name: "Vendor",
    email: "vendor@example.test",
    role: "vendor",
  });
  await page.goto("/checkout");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/orders");
  await expect(page).toHaveURL(/\/dashboard$/);

  await mockApi(page, null);
  await page.goto("/checkout");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});

test("the courier's run offers only the move that is legal for each order", async ({
  page,
}) => {
  await mockApi(page, {
    user_id: 4,
    name: "Courier",
    email: "delivery@example.test",
    role: "delivery",
  });
  let advanced = false;
  await page.route("**/api/delivery/deliveries", (route) =>
    route.fulfill({
      json: [
        {
          ...order,
          order_status: advanced ? "shipped" : "pending",
          customer_name: "Customer",
          customer_phone: "+100",
          items: [
            { prod_id: 1, name: "Keyboard", shop_name: "Shop", quantity: 2 },
          ],
        },
        {
          ...order,
          order_id: 8,
          order_status: "shipped",
          customer_name: "Customer",
          customer_phone: "+100",
          items: [],
        },
      ],
    }),
  );
  let put;
  await page.route("**/api/delivery/orders/*/status", (route) => {
    put = route.request().postDataJSON();
    advanced = true;
    return route.fulfill({ json: { message: "Order marked as shipped." } });
  });

  await page.goto("/delivery/deliveries");
  const first = page.locator(".order-card").filter({ hasText: "Order #7" });
  const second = page.locator(".order-card").filter({ hasText: "Order #8" });
  // A pending order can be collected, not delivered; a shipped one is the other
  // way round. Neither card offers both.
  await expect(
    first.getByRole("button", { name: "Mark collected" }),
  ).toBeVisible();
  await expect(second.getByRole("button", { name: "Mark delivered" })).toBeVisible();

  await first.getByRole("button", { name: "Mark collected" }).click();
  await expect(
    first.getByRole("button", { name: "Mark delivered" }),
  ).toBeVisible();
  expect(put).toEqual({ order_status: "shipped" });
});

test("a courier can claim an open order and then see it on their run", async ({
  page,
}) => {
  const courier = {
    user_id: 4,
    name: "Courier",
    email: "delivery@example.test",
    role: "delivery",
  };
  await mockApi(page, courier);
  const offered = {
    ...order,
    order_id: 9,
    delivery_cost: "3.40",
    payment_amount: "23.40",
    items: [{ prod_id: 1, name: "Keyboard", shop_name: "Shop", quantity: 2 }],
  };
  let claimed = false;
  await page.route("**/api/delivery/open-orders", (route) =>
    route.fulfill({ json: claimed ? [] : [offered] }),
  );
  await page.route("**/api/delivery/deliveries", (route) =>
    route.fulfill({
      json: claimed
        ? [{ ...offered, customer_name: "Customer", customer_phone: "+100" }]
        : [],
    }),
  );
  await page.route("**/api/delivery/returns", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/delivery/orders/9/claim", (route) => {
    expect(route.request().method()).toBe("PUT");
    claimed = true;
    return route.fulfill({ json: { message: "Order #9 is yours." } });
  });

  await page.goto("/delivery/deliveries");
  const card = page.locator(".order-card").filter({ hasText: "Order #9" });
  await expect(card).toContainText("$3.40");
  await expect(card).not.toContainText("Customer");
  await card.getByRole("button", { name: "Accept this delivery" }).click();

  const claimedCard = page
    .locator(".order-card")
    .filter({ hasText: "Order #9" });
  await expect(claimedCard).toHaveCount(1);
  await expect(claimedCard).toContainText("Customer");
  await expect(
    claimedCard.getByRole("button", { name: "Mark collected" }),
  ).toBeVisible();
});
