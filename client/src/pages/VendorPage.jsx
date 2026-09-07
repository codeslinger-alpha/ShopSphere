import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/http";
import { useResource, useTask } from "../hooks/useResource";
import {
  AddressFields,
  Feedback,
  MarkdownField,
  MasterFacts,
} from "../components/FormFields";
function ShopEditor({ shop, onSave, busy }) {
  return (
    <form
      className="panel form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      <h2>{shop.shop_id ? "Edit shop" : "Create shop"}</h2>
      <fieldset disabled={busy}>
        <label>
          Shop name
          <input
            name="name"
            defaultValue={shop.name || ""}
            maxLength="120"
            required
          />
        </label>
        <label>
          Shop phone
          <input
            name="phone_numbers"
            type="tel"
            defaultValue={shop.phone_numbers || ""}
            maxLength="20"
            required
          />
        </label>
        <label>
          Logo URL
          <input name="logo" type="url" defaultValue={shop.logo || ""} />
        </label>
        <label>
          Cover photo URL
          <input
            name="cover_photo"
            type="url"
            defaultValue={shop.cover_photo || ""}
          />
        </label>
        <MarkdownField value={shop.description} />
        <AddressFields value={shop} />
        <label>
          Status
          <select
            name="active_status"
            defaultValue={shop.active_status || "active"}
          >
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <button className="primary">Save shop</button>
      </fieldset>
    </form>
  );
}
function ListingEditor({ listing, onSave, busy }) {
  return (
    <form
      className="panel form"
      onSubmit={(e) => {
        e.preventDefault();
        const b = Object.fromEntries(new FormData(e.currentTarget));
        onSave({ ...b, discontinued: b.discontinued === "true" });
      }}
    >
      <h2>Edit {listing.name}</h2>
      <p>Stock: {listing.in_stock}. Buy more units to restock.</p>
      <fieldset disabled={busy}>
        <label>
          Retail price
          <input
            name="unit_price"
            type="number"
            min="0"
            max="9999999999.99"
            step="0.01"
            defaultValue={listing.unit_price}
            required
          />
        </label>
        <MarkdownField label="Your description" value={listing.description} />
        <label>
          Listing status
          <select
            name="discontinued"
            defaultValue={String(listing.discontinued)}
          >
            <option value="false">Listed</option>
            <option value="true">Discontinued</option>
          </select>
        </label>
        <button className="primary">Save listing</button>
      </fieldset>
    </form>
  );
}
export default function VendorPage({ page }) {
  const shops = useResource("/vendor/shops"),
    masters = useResource("/vendor/master-products"),
    listings = useResource("/vendor/listings"),
    purchases = useResource("/vendor/purchases"),
    task = useTask();
  const [shop, setShop] = useState({}),
    [selected, setSelected] = useState(""),
    [editing, setEditing] = useState(null),
    [revision, setRevision] = useState(0);
  const product =
    masters.data?.find((p) => String(p.master_prod_id) === selected) ||
    masters.data?.[0];
  const activeShops =
    shops.data?.filter((s) => s.active_status === "active") || [];
  async function write(path, method, body) {
    return task.run(() => api(path, { method, body: JSON.stringify(body) }));
  }
  return (
    <main className="content">
      <h1>{page === "shops" ? "My shops" : "Buy and list products"}</h1>
      <nav className="tabs">
        <Link to="/vendor/shops">My shops</Link>
        <Link to="/vendor/inventory">Inventory and purchases</Link>
      </nav>
      <Feedback
        error={
          task.error ||
          shops.error ||
          masters.error ||
          listings.error ||
          purchases.error
        }
        message={task.message}
      />
      {page === "shops" ? (
        <div className="workspace-grid">
          <section>
            <button onClick={() => setShop({})}>New shop</button>
            {shops.data?.map((s) => (
              <article className="collection-row" key={s.shop_id}>
                <div>
                  <h2>{s.name}</h2>
                  <p>
                    {s.active_status} · {s.city} · Earnings {s.earnings}
                  </p>
                  <p>
                    ID {s.shop_id} · Owner {s.owner} · Created{" "}
                    {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={() => setShop(s)}>Edit shop</button>
              </article>
            ))}
          </section>
          <ShopEditor
            key={`${shop.shop_id || "new"}:${revision}`}
            shop={shop}
            busy={task.busy}
            onSave={async (body) => {
              if (
                await write(
                  shop.shop_id
                    ? `/vendor/shops/${shop.shop_id}`
                    : "/vendor/shops",
                  shop.shop_id ? "PUT" : "POST",
                  body,
                )
              ) {
                shops.reload();
                setShop({});
                setRevision((n) => n + 1);
              }
            }}
          />
        </div>
      ) : (
        <>
          <div className="workspace-grid">
            <form
              className="panel form"
              key={revision}
              onSubmit={async (e) => {
                e.preventDefault();
                const body = Object.fromEntries(new FormData(e.currentTarget));
                if (await write("/vendor/listings", "POST", body)) {
                  listings.reload();
                  purchases.reload();
                  setRevision((n) => n + 1);
                }
              }}
            >
              <h2>Wholesale purchase</h2>
              <p>
                Buying an existing shop/product pair adds stock to its listing.
                Prices are recorded at purchase time. This demo records
                purchases without charging a payment account.
              </p>
              <fieldset disabled={task.busy || !product || !activeShops.length}>
                <label>
                  Shop
                  <select name="shop_id" required>
                    <option value="">Choose your shop</option>
                    {activeShops.map((s) => (
                      <option key={s.shop_id} value={s.shop_id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Master product
                  <select
                    name="master_prod_id"
                    value={product?.master_prod_id || ""}
                    onChange={(e) => setSelected(e.target.value)}
                    required
                  >
                    {masters.data?.map((p) => (
                      <option key={p.master_prod_id} value={p.master_prod_id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Purchase quantity
                  <input
                    name="quantity"
                    type="number"
                    min="1"
                    max="2147483647"
                    required
                  />
                </label>
                <label>
                  Your retail price
                  <input
                    name="unit_price"
                    type="number"
                    min="0"
                    max="9999999999.99"
                    step="0.01"
                    required
                  />
                </label>
                <MarkdownField label="Your description" />
                <button className="primary">Buy and list product</button>
              </fieldset>
              {!activeShops.length && <p>Create an active shop first.</p>}
              {masters.data?.length === 0 && (
                <p>No available master products.</p>
              )}
            </form>
            {product && <MasterFacts product={product} />}
          </div>
          <h2>Your listings</h2>
          {listings.data?.map((p) => (
            <article className="collection-row" key={p.prod_id}>
              <div>
                <h3>{p.name}</h3>
                <p>
                  {p.shop_name} · {p.category_name} · Stock {p.in_stock} · $
                  {p.unit_price} · {p.discontinued ? "Discontinued" : "Listed"}
                </p>
                <p>
                  ID {p.prod_id} · Master {p.master_prod_id}
                </p>
              </div>
              <button onClick={() => setEditing(p)}>Edit listing</button>
            </article>
          ))}
          {editing && (
            <ListingEditor
              key={editing.prod_id}
              listing={editing}
              busy={task.busy}
              onSave={async (body) => {
                if (
                  await write(
                    `/vendor/listings/${editing.prod_id}`,
                    "PUT",
                    body,
                  )
                ) {
                  setEditing(null);
                  listings.reload();
                }
              }}
            />
          )}
          <h2>Wholesale purchase history</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID / date</th>
                  <th>Shop / product</th>
                  <th>Quantity</th>
                  <th>Unit cost</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {purchases.data?.map((p) => (
                  <tr key={p.purchase_id}>
                    <td>
                      {p.purchase_id} /{" "}
                      {new Date(p.purchased_at).toLocaleString()}
                    </td>
                    <td>
                      {p.shop_name} / {p.name}
                    </td>
                    <td>{p.quantity}</td>
                    <td>{p.wholesale_unit_price}</td>
                    <td>{p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
