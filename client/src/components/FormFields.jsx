import ReactMarkdown from "react-markdown";
import { useState } from "react";
import { useResource } from "../hooks/useResource";
export function Feedback({ error, message }) {
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </>
  );
}
export function AddressFields({ value = {} }) {
  const { data: countries, error } = useResource("/countries");
  return (
    <>
      <label>
        Street address
        <input
          name="street_address"
          maxLength="500"
          defaultValue={value.street_address || ""}
          required
        />
      </label>
      <label>
        City
        <input
          name="city"
          maxLength="100"
          defaultValue={value.city || ""}
          required
        />
      </label>
      <label>
        Postal code
        <input
          name="postal_code"
          maxLength="30"
          defaultValue={value.postal_code || ""}
        />
      </label>
      <label>
        State/province
        <input
          name="state_province"
          maxLength="100"
          defaultValue={value.state_province || ""}
        />
      </label>
      <label>
        Country
        {countries ? (
          <select
            name="country_id"
            defaultValue={value.country_id || "BD"}
            required
          >
            <option value="">Choose country</option>
            {countries.map((c) => (
              <option key={c.country_id} value={c.country_id}>
                {c.country_name}
              </option>
            ))}
          </select>
        ) : (
          <span>{error || "Loading countries…"}</span>
        )}
      </label>
    </>
  );
}
export function ContactFields({ value = {}, delivery = false }) {
  return (
    <>
      <label>
        Phone
        <input
          name="phone"
          type="tel"
          maxLength="20"
          defaultValue={value.phone || ""}
          required
        />
      </label>
      <label>
        Profile image URL
        <input
          name="pfp"
          type="url"
          maxLength="2000"
          defaultValue={value.pfp || ""}
        />
      </label>
      <AddressFields value={value} />
      {delivery && (
        <label>
          Vehicle information
          <textarea
            name="vehicle_info"
            maxLength="500"
            defaultValue={value.vehicle_info || ""}
            required
          />
        </label>
      )}
    </>
  );
}
export function MarkdownField({
  label = "Description",
  name = "description",
  value = "",
}) {
  const [draft, setDraft] = useState(value || "");
  return (
    <>
      <label>
        {label} (Markdown)
        <textarea
          name={name}
          maxLength="20000"
          rows="6"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <details>
        <summary>Preview description</summary>
        <div className="markdown">
          <ReactMarkdown>{draft || "No description yet."}</ReactMarkdown>
        </div>
      </details>
    </>
  );
}
export function MasterFacts({ product }) {
  return (
    <fieldset className="master-facts">
      <legend>Fill attributes — from master catalog</legend>
      <p className="muted">
        These values are supplied by the administrator and cannot be edited by a
        shop owner.
      </p>
      {[
        ["Name", product.name],
        ["Manufacturer", product.manufacturer],
        ["Category", product.category_name],
        ["Wholesale price", product.wholesale_price],
        ["Image URL", product.images || ""],
      ].map(([name, value]) => (
        <label key={name}>
          {name}
          <input value={value ?? ""} readOnly />
        </label>
      ))}
      {product.attributes?.map((a) => (
        <label key={a.attribute_id}>
          {a.name}
          {a.required ? " (category required)" : " (product specific)"}
          <input value={a.attrib_value} readOnly />
        </label>
      ))}
      <div className="markdown">
        <ReactMarkdown>
          {product.description || "No master description."}
        </ReactMarkdown>
      </div>
    </fieldset>
  );
}
