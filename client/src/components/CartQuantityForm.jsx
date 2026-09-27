import { useState } from "react";

export default function CartQuantityForm({ item, disabled, onUpdate }) {
  // An editable draft; the subtotal always uses the quantity saved by the server.
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (disabled) return;
    setError("");
    const number = Number(quantity);
    if (
      !/^[1-9]\d*$/.test(quantity) ||
      !Number.isInteger(number) ||
      number > item.in_stock
    ) {
      setError(`Enter a whole number between 1 and ${item.in_stock}.`);
      setQuantity(String(item.quantity));
      return;
    }
    const saved = await onUpdate(item.prod_id, number);
    if (!saved) setQuantity(String(item.quantity));
  }

  return (
    <form className="quantity-form" onSubmit={handleSubmit} noValidate>
      <label>
        <span>Quantity <span className="required-tag" aria-hidden="true">*</span></span>
        <input
          aria-label={`Quantity for ${item.name}`}
          type="number"
          required
          min="1"
          max={item.in_stock}
          step="1"
          value={quantity}
          disabled={disabled}
          onChange={(event) => {
            setQuantity(event.target.value);
            setError("");
          }}
        />
      </label>
      <button
        type="submit"
        disabled={disabled || quantity === String(item.quantity)}
      >
        Update
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="required-note">*required</p>
    </form>
  );
}
