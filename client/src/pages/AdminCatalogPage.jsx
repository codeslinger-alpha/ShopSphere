import { useState } from "react";
import { api } from "../api/http";
import { useResource, useTask } from "../hooks/useResource";
import { Feedback, MarkdownField } from "../components/FormFields";
function MasterEditor({ product, metadata, busy, onSave }) {
  const [category, setCategory] = useState(String(product.category_id || ""));
  const [additional, setAdditional] = useState([]);
  const required =
    metadata.categories.find((c) => String(c.category_id) === category)
      ?.attribute_ids || [];
  const existing = (product.attributes || []).map(
    (attribute) => attribute.attribute_id,
  );
  const optional = existing.filter(
    (attributeId) => !required.includes(attributeId),
  );
  const attributeValue = (attributeId) =>
    product.attributes?.find(
      (attribute) => attribute.attribute_id === attributeId,
    )?.attrib_value || "";
  async function submit(e) {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    const attributeIds = [...new Set([...required, ...existing])];
    const attributes = attributeIds
      .filter((attributeId) => b[`attribute:${attributeId}`]?.trim())
      .map((attributeId) => ({
        attribute_id: attributeId,
        attrib_value: b[`attribute:${attributeId}`],
      }));
    for (const attributeId of attributeIds) delete b[`attribute:${attributeId}`];
    await onSave({ ...b, attributes, additional_attributes: additional });
  }
  function changeCategory(e) {
    setCategory(e.target.value);
  }
  function AttributeInput({ attributeId, isRequired = false }) {
    const attribute = metadata.attributes.find(
      (item) => item.attribute_id === attributeId,
    );
    if (!attribute) return null;
    return (
      <div className="attribute-row">
        <label>
          {attribute.name} {isRequired ? "(category required)" : ""}
          <small>{attribute.description}</small>
          <input
            name={`attribute:${attribute.attribute_id}`}
            defaultValue={attributeValue(attribute.attribute_id)}
            maxLength="500"
            required={isRequired}
          />
        </label>
      </div>
    );
  }
  return (
    <form className="panel form" onSubmit={submit}>
      <h2>
        {product.master_prod_id
          ? `Edit master #${product.master_prod_id}`
          : "New master product"}
      </h2>
      <fieldset disabled={busy}>
        <label>
          Name
          <input
            name="name"
            defaultValue={product.name || ""}
            maxLength="200"
            required
          />
        </label>
        <label>
          Manufacturer
          <input
            name="manufacturer"
            defaultValue={product.manufacturer || ""}
            maxLength="200"
            required
          />
        </label>
        <label>
          Image URL
          <input
            name="images"
            type="url"
            defaultValue={product.images || ""}
            maxLength="2000"
          />
        </label>
        <MarkdownField value={product.description} />
        <label>
          Category
          <select
            name="category_id"
            value={category}
            onChange={changeCategory}
            required
          >
            <option value="">Choose category</option>
            {metadata.categories.map((c) => (
              <option key={c.category_id} value={c.category_id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Wholesale price
          <input
            name="wholesale_price"
            type="number"
            min="0"
            step="0.01"
            max="9999999999.99"
            defaultValue={product.wholesale_price || ""}
            required
          />
        </label>
        <label>
          Status
          <select
            name="active_status"
            defaultValue={product.active_status || "available"}
          >
            <option value="available">Available</option>
            <option value="discontinued">Discontinued</option>
          </select>
        </label>
        <h3>Attribute values</h3>
        <p>
          Category attributes are required. Add product-specific attributes
          below.
        </p>
        {required.map((attributeId) => (
          <AttributeInput key={attributeId} attributeId={attributeId} isRequired />
        ))}
        {optional.map((attributeId) => (
          <AttributeInput key={attributeId} attributeId={attributeId} />
        ))}
        <h3>Additional attributes</h3>
        {additional.map((attribute, index) => (
          <div className="attribute-row" key={index}>
            <label>
              Name
              <input
                value={attribute.name}
                maxLength="100"
                onChange={(e) =>
                  setAdditional((items) =>
                    items.map((item, i) =>
                      i === index ? { ...item, name: e.target.value } : item,
                    ),
                  )
                }
                required
              />
            </label>
            <label>
              Value
              <input
                value={attribute.value}
                maxLength="500"
                onChange={(e) =>
                  setAdditional((items) =>
                    items.map((item, i) =>
                      i === index ? { ...item, value: e.target.value } : item,
                    ),
                  )
                }
                required
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setAdditional((items) =>
                  items.filter((_, i) => i !== index),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setAdditional((items) => [...items, { name: "", value: "" }])
          }
        >
          Add attribute
        </button>
        <button className="primary">Save master product</button>
      </fieldset>
    </form>
  );
}
function CategoryEditor({ category, metadata, busy, onSave }) {
  const [required, setRequired] = useState(category.attribute_ids || []);
  function submit(e) {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    const required_attributes = required.map((id) => ({
      attribute_id: id,
      default_value: b[`default:${id}`] || "",
    }));
    onSave({
      name: b.name,
      description: b.description,
      parent_category: b.parent_category || null,
      required_attributes,
    });
  }
  return (
    <form className="panel form" onSubmit={submit}>
      <h2>{category.category_id ? "Edit category" : "New category"}</h2>
      <fieldset disabled={busy}>
        <label>
          Category name
          <input
            name="name"
            defaultValue={category.name || ""}
            maxLength="120"
            required
          />
        </label>
        <label>
          Category description
          <textarea
            name="description"
            defaultValue={category.description || ""}
            maxLength="5000"
          />
        </label>
        <label>
          Parent category
          <select
            name="parent_category"
            defaultValue={category.parent_category || ""}
          >
            <option value="">None</option>
            {metadata.categories
              .filter((c) => c.category_id !== category.category_id)
              .map((c) => (
                <option key={c.category_id} value={c.category_id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <h3>Required category attributes</h3>
        <p>
          Requirements apply to this category directly. When adding a
          requirement to existing products, enter a value for products missing
          it, or update those products first. Existing values are preserved.
        </p>
        {metadata.attributes.map((a) => (
          <div key={a.attribute_id}>
            <label className="check-label">
              <input
                type="checkbox"
                checked={required.includes(a.attribute_id)}
                onChange={(e) =>
                  setRequired((ids) =>
                    e.target.checked
                      ? [...ids, a.attribute_id]
                      : ids.filter((id) => id !== a.attribute_id),
                  )
                }
              />
              {a.name}
            </label>
            {required.includes(a.attribute_id) && (
              <label>
                Value for existing products missing {a.name}
                <input name={`default:${a.attribute_id}`} maxLength="500" />
              </label>
            )}
          </div>
        ))}
        <button className="primary">Save category</button>
      </fieldset>
    </form>
  );
}
export default function AdminCatalogPage() {
  const metadata = useResource("/admin/catalog-metadata"),
    masters = useResource("/admin/master-products"),
    task = useTask();
  const [tab, setTab] = useState("products"),
    [product, setProduct] = useState({}),
    [category, setCategory] = useState({}),
    [revision, setRevision] = useState(0),
    // Which master product is one click away from being discontinued. That now
    // refunds every vendor holding stock of it, which cannot be undone, so it
    // takes a second deliberate click rather than a single slip.
    [confirming, setConfirming] = useState(null);
  async function write(path, method, body) {
    const ok = await task.run(() =>
      api(path, { method, body: body ? JSON.stringify(body) : undefined }),
    );
    if (ok) {
      metadata.reload();
      masters.reload();
      setRevision((n) => n + 1);
    }
    return ok;
  }
  return (
    <main className="content">
      <h1>Master catalog administration</h1>
      <nav className="tabs">
        <button onClick={() => setTab("products")}>Master products</button>
        <button onClick={() => setTab("categories")}>
          Categories and attributes
        </button>
      </nav>
      <Feedback
        error={task.error || metadata.error || masters.error}
        message={task.message}
      />
      {metadata.data && masters.data ? (
        <div className="workspace-grid">
          <section>
            {tab === "products" ? (
              <>
                <button
                  onClick={() => {
                    setProduct({});
                    setRevision((n) => n + 1);
                  }}
                >
                  New master product
                </button>
                {masters.data.map((p) => (
                  <article className="panel" key={p.master_prod_id}>
                    <h2>{p.name}</h2>
                    <p>
                      {p.category_name} · {p.manufacturer} · Wholesale{" "}
                      {p.wholesale_price} · {p.active_status}
                    </p>
                    <p>
                      ID {p.master_prod_id} · Created{" "}
                      {new Date(p.date_created).toLocaleString()}
                    </p>
                    {p.attributes.map((a) => (
                      <p key={a.attribute_id}>
                        {a.name}: {a.attrib_value}
                      </p>
                    ))}
                    <button onClick={() => setProduct(p)}>Edit master</button>{" "}
                    {p.active_status === "discontinued" ? (
                      <button disabled>Discontinued</button>
                    ) : confirming === p.master_prod_id ? (
                      <>
                        <button
                          className="danger"
                          disabled={task.busy}
                          onClick={async () => {
                            await write(
                              `/admin/master-products/${p.master_prod_id}`,
                              "DELETE",
                            );
                            setConfirming(null);
                          }}
                        >
                          Confirm: discontinue and refund every vendor holding it
                        </button>{" "}
                        <button
                          disabled={task.busy}
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={task.busy}
                        onClick={() => setConfirming(p.master_prod_id)}
                      >
                        Delete (discontinue)
                      </button>
                    )}
                  </article>
                ))}
              </>
            ) : (
              <>
                <form
                  className="panel form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    if (
                      await write(
                        "/admin/attributes",
                        "POST",
                        Object.fromEntries(new FormData(form)),
                      )
                    )
                      form.reset();
                  }}
                >
                  <h2>Define an attribute</h2>
                  <label>
                    Attribute name
                    <input name="name" maxLength="100" required />
                  </label>
                  <label>
                    Attribute description
                    <textarea name="description" maxLength="2000" />
                  </label>
                  <button className="primary" disabled={task.busy}>
                    Create attribute
                  </button>
                </form>
                <h2>Categories</h2>
                <button
                  onClick={() => {
                    setCategory({});
                    setRevision((n) => n + 1);
                  }}
                >
                  New category
                </button>
                {metadata.data.categories.map((c) => (
                  <article className="panel" key={c.category_id}>
                    <h3>{c.name}</h3>
                    <p>{c.description}</p>
                    <p>
                      Parent:{" "}
                      {metadata.data.categories.find(
                        (p) => p.category_id === c.parent_category,
                      )?.name || "None"}
                    </p>
                    <p>
                      Required:{" "}
                      {metadata.data.attributes
                        .filter((a) => c.attribute_ids.includes(a.attribute_id))
                        .map((a) => a.name)
                        .join(", ") || "None"}
                    </p>
                    <button onClick={() => setCategory(c)}>
                      Edit category
                    </button>{" "}
                    <button
                      disabled={task.busy}
                      onClick={() =>
                        write(`/admin/categories/${c.category_id}`, "DELETE")
                      }
                    >
                      Delete empty category
                    </button>
                  </article>
                ))}
              </>
            )}
          </section>
          {tab === "products" ? (
            <MasterEditor
              key={`p:${product.master_prod_id || "new"}:${revision}`}
              product={product}
              metadata={metadata.data}
              busy={task.busy}
              onSave={async (b) => {
                if (
                  await write(
                    product.master_prod_id
                      ? `/admin/master-products/${product.master_prod_id}`
                      : "/admin/master-products",
                    product.master_prod_id ? "PUT" : "POST",
                    b,
                  )
                )
                  setProduct({});
              }}
            />
          ) : (
            <CategoryEditor
              key={`c:${category.category_id || "new"}:${revision}`}
              category={category}
              metadata={metadata.data}
              busy={task.busy}
              onSave={async (b) => {
                if (
                  await write(
                    category.category_id
                      ? `/admin/categories/${category.category_id}`
                      : "/admin/categories",
                    category.category_id ? "PUT" : "POST",
                    b,
                  )
                )
                  setCategory({});
              }}
            />
          )}
        </div>
      ) : (
        !metadata.error && !masters.error && <p>Loading catalog…</p>
      )}
    </main>
  );
}
