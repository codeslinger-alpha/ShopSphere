const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { once } = require("node:events");
require("dotenv").config({ quiet: true });
process.env.JWT_SECRET = "shopsphere-isolated-regression-test-secret";
const app = require("../src/index");
const pool = require("../src/config/db");

// Catalog discovery over the real schema: search, category/subcategory scope,
// attribute facets, price, sort and paging. Each check runs inside a savepoint
// that is rolled back, so the seeded demo data is identical for every case.
test("catalog search, filtering and facets against PostgreSQL", async (t) => {
  pool.options.connectionTimeoutMillis = 10000;
  let client;
  let server;
  const originalQuery = pool.query;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const namespace = `shopsphere_catalog_check_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    await client.query(await fs.readFile("sql/schema.sql", "utf8"));
    await client.query(
      await fs.readFile("sql/test_insert/seed_demo.sql", "utf8"),
    );
    // All API reads/writes in this test use this isolated transaction.
    pool.query = (...args) => client.query(...args);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;

    const one = async (sql, values = []) =>
      (await client.query(sql, values)).rows[0];

    // The seed gives every demo master a Demo Color and a Demo Connection value,
    // and lists all four masters at both demo shops: eight listings in total.
    const electronics = await one(
      "SELECT category_id FROM categories WHERE name = 'Demo Electronics'",
    );
    const home = await one(
      "SELECT category_id FROM categories WHERE name = 'Demo Home'",
    );
    const color = await one(
      "SELECT attribute_id FROM attributes WHERE name = 'Demo Color'",
    );
    const connection = await one(
      "SELECT attribute_id FROM attributes WHERE name = 'Demo Connection'",
    );
    const shop = await one(
      "SELECT shop_id FROM shops WHERE name = 'Demo Tech Corner'",
    );

    function queryString(params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value))
          for (const item of value) search.append(key, item);
        else search.append(key, value);
      }
      return search.toString();
    }

    async function get(path, params) {
      const query = params ? `?${queryString(params)}` : "";
      const response = await fetch(origin + path + query);
      return { status: response.status, data: await response.json() };
    }

    const products = (params) => get("/api/products", params);
    const facets = (params) => get("/api/products/facets", params);

    async function check(name, run) {
      await t.test(name, async () => {
        await client.query("SAVEPOINT catalog_case");
        try {
          await run();
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT catalog_case");
        }
      });
    }

    await check("browsing without filters returns a page of listings", async () => {
      const result = await products();
      assert.equal(result.status, 200);
      assert.equal(result.data.total, 8);
      assert.equal(result.data.page, 1);
      assert.equal(result.data.limit, 24);
      assert.equal(result.data.total_pages, 1);
      assert.equal(result.data.items.length, 8);
      // The window count is transport, not a product field.
      assert.equal("total_count" in result.data.items[0], false);
      assert.equal(result.data.items[0].shop_name.length > 0, true);
    });

    await check("search spans the listing, master and category names", async () => {
      assert.equal((await products({ q: "keyboard" })).data.total, 2);
      assert.equal((await products({ q: "KEYBOARD" })).data.total, 2);
      assert.equal((await products({ q: "ShopSphere Demo" })).data.total, 8);
      assert.equal((await products({ q: "USB-powered" })).data.total, 2);
      assert.equal((await products({ q: "Demo Electronics" })).data.total, 6);
      assert.equal((await products({ q: "nothing matches this" })).data.total, 0);
      assert.equal((await products({ q: "  " })).data.total, 8);
    });

    await check("ILIKE metacharacters are matched literally", async () => {
      // Unescaped, "%" would match every listing and "_" any single character.
      assert.equal((await products({ q: "%" })).data.total, 0);
      assert.equal((await products({ q: "_" })).data.total, 0);
      assert.equal((await products({ q: "Demo%" })).data.total, 0);
    });

    await check("a parent category includes its subcategories", async () => {
      assert.equal(
        (await products({ category_id: electronics.category_id })).data.total,
        6,
      );
      assert.equal(
        (await products({ category_id: home.category_id })).data.total,
        2,
      );

      const subcategory = await one(
        `INSERT INTO categories (name, description, parent_category)
         VALUES ('Demo Audio', 'Nested under electronics.', $1)
         RETURNING category_id`,
        [electronics.category_id],
      );
      const master = await one(
        `INSERT INTO master_products
           (manufacturer, name, description, category_id, wholesale_price)
         VALUES ('ShopSphere Demo', 'Demo Subcategory Speaker',
                 'Only reachable through its parent.', $1, 30.00)
         RETURNING master_prod_id`,
        [subcategory.category_id],
      );
      await client.query(
        `INSERT INTO products (name, master_prod_id, description, shop_id, in_stock, unit_price)
         VALUES ('Demo Subcategory Speaker', $1, 'Nested listing.', $2, 5, 45.00)`,
        [master.master_prod_id, shop.shop_id],
      );

      assert.equal(
        (await products({ category_id: electronics.category_id })).data.total,
        7,
      );
      // The child is still individually selectable.
      assert.equal(
        (await products({ category_id: subcategory.category_id })).data.total,
        1,
      );
      assert.equal((await products()).data.total, 9);
    });

    await check("attribute values OR within an attribute and AND across", async () => {
      const black = `${color.attribute_id}:Black`;
      const blue = `${color.attribute_id}:Blue`;
      const bluetooth = `${connection.attribute_id}:Bluetooth`;
      const usb = `${connection.attribute_id}:USB`;

      assert.equal((await products({ attribute: [black] })).data.total, 4);
      assert.equal((await products({ attribute: [black, blue] })).data.total, 6);
      assert.equal((await products({ attribute: [black, black] })).data.total, 4);
      assert.equal((await products({ attribute: [black, bluetooth] })).data.total, 4);
      assert.equal((await products({ attribute: [black, usb] })).data.total, 0);
      assert.equal((await products({ attribute: [usb] })).data.total, 2);
      assert.deepEqual(
        (await products({ attribute: [black, blue] })).data.items
          .map((item) => item.name)
          .sort(),
        [
          "Demo Bluetooth Headphones",
          "Demo Bluetooth Headphones",
          "Demo Fitness Watch",
          "Demo Fitness Watch",
          "Demo Wireless Keyboard",
          "Demo Wireless Keyboard",
        ],
      );
    });

    await check("price bounds are inclusive and combine with other filters", async () => {
      assert.equal((await products({ min_price: "50" })).data.total, 4);
      assert.equal((await products({ max_price: "20" })).data.total, 2);
      assert.equal((await products({ min_price: "19", max_price: "20" })).data.total, 2);
      assert.equal(
        (
          await products({
            category_id: electronics.category_id,
            min_price: "60",
          })
        ).data.total,
        2,
      );
      assert.equal((await products({ min_price: "1000" })).data.total, 0);
    });

    await check("sort orders are applied and stable", async () => {
      const ascending = (
        await products({ sort: "price_asc" })
      ).data.items.map((item) => Number(item.unit_price));
      assert.deepEqual(ascending, [...ascending].sort((a, b) => a - b));
      assert.equal(ascending[0], 19);

      const descending = (
        await products({ sort: "price_desc" })
      ).data.items.map((item) => Number(item.unit_price));
      assert.deepEqual(descending, [...descending].sort((a, b) => b - a));
      assert.equal(descending[0], 80);

      const byName = (await products({ sort: "name" })).data.items.map(
        (item) => item.name,
      );
      assert.deepEqual(byName, [...byName].sort());

      // Every sort must be a total order, or paging would repeat or skip rows.
      const newest = (await products({ sort: "newest" })).data.items;
      assert.equal(new Set(newest.map((item) => item.prod_id)).size, 8);
    });

    await check("paging splits the result set without gaps or repeats", async () => {
      const first = await products({ limit: "3", page: "1" });
      assert.equal(first.data.total, 8);
      assert.equal(first.data.limit, 3);
      assert.equal(first.data.total_pages, 3);
      assert.equal(first.data.items.length, 3);

      const second = await products({ limit: "3", page: "2" });
      const third = await products({ limit: "3", page: "3" });
      assert.equal(second.data.items.length, 3);
      assert.equal(third.data.items.length, 2);

      const paged = [first, second, third].flatMap((page) =>
        page.data.items.map((item) => item.prod_id),
      );
      assert.equal(paged.length, 8);
      assert.equal(new Set(paged).size, 8);

      const full = await products({ limit: "60" });
      assert.deepEqual(
        paged.slice().sort((a, b) => a - b),
        full.data.items.map((item) => item.prod_id).sort((a, b) => a - b),
      );
    });

    await check("facets list each attribute value with a listing count", async () => {
      const result = await facets();
      assert.equal(result.status, 200);
      // Regression guard: /products/facets must not be read as a product ID.
      assert.equal(Array.isArray(result.data), true);

      const scoped = await facets({ category_id: electronics.category_id });
      assert.deepEqual(scoped.data, [
        {
          attribute_id: color.attribute_id,
          attribute_name: "Demo Color",
          value: "Black",
          listing_count: 4,
        },
        {
          attribute_id: color.attribute_id,
          attribute_name: "Demo Color",
          value: "Blue",
          listing_count: 2,
        },
        {
          attribute_id: connection.attribute_id,
          attribute_name: "Demo Connection",
          value: "Bluetooth",
          listing_count: 6,
        },
      ]);

      const homeFacets = await facets({ category_id: home.category_id });
      assert.deepEqual(
        homeFacets.data.map((row) => `${row.attribute_name}=${row.value}:${row.listing_count}`),
        ["Demo Color=White:2", "Demo Connection=USB:2"],
      );
    });

    await check("facet counts follow the search but ignore ticked boxes", async () => {
      const searched = await facets({ q: "keyboard" });
      assert.deepEqual(
        searched.data.map((row) => `${row.value}:${row.listing_count}`),
        ["Black:2", "Bluetooth:2"],
      );

      // Ticking a box must not collapse the other counts to the selection.
      const ticked = await facets({
        category_id: electronics.category_id,
        attribute: `${color.attribute_id}:Black`,
      });
      const unticked = await facets({
        category_id: electronics.category_id,
      });
      assert.deepEqual(ticked.data, unticked.data);
    });

    await check("facets never count discontinued or unavailable listings", async () => {
      await client.query(
        "UPDATE products SET discontinued = true WHERE name = 'Demo Wireless Keyboard'",
      );
      const result = await facets({ category_id: electronics.category_id });
      const black = result.data.find((row) => row.value === "Black");
      assert.equal(black.listing_count, 2);
      assert.equal((await products({ attribute: `${color.attribute_id}:Black` })).data.total, 2);
    });

    await check("invalid query parameters are rejected with 400", async () => {
      for (const params of [
        { sort: "bogus" },
        { limit: "0" },
        { limit: "999" },
        { limit: "1.5" },
        { page: "abc" },
        { page: "0" },
        { category_id: "-1" },
        { category_id: "1e3" },
        { min_price: "abc" },
        { min_price: "-5" },
        { min_price: "10", max_price: "5" },
        { attribute: "bad" },
        { attribute: "0:Black" },
        { attribute: `${color.attribute_id}:` },
        { attribute: ":Black" },
      ]) {
        const result = await products(params);
        assert.equal(result.status, 400, JSON.stringify(params));
        assert.equal(typeof result.data.message, "string");
      }
      // A value containing a colon is still one value.
      const spaced = await products({
        attribute: `${connection.attribute_id}:Wi:Fi`,
      });
      assert.equal(spaced.status, 200);
      assert.equal(spaced.data.total, 0);
    });

    await check("database errors surface as 500 rather than an empty catalog", async () => {
      const workingQuery = pool.query;
      const log = t.mock.method(console, "error", () => {});
      pool.query = async () => {
        throw new Error("Simulated database outage");
      };
      try {
        assert.equal((await products()).status, 500);
        assert.equal((await facets()).status, 500);
      } finally {
        pool.query = workingQuery;
        log.mock.restore();
      }
    });
  } finally {
    pool.query = originalQuery;
    if (server) await new Promise((resolve) => server.close(resolve));
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
    await pool.end();
  }
});
