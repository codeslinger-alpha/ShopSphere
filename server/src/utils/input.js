const { parsePositiveInteger } = require("./validation");
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function string(value, label, max = 500, required = false) {
  if (value === undefined || value === null) value = "";
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    fail(
      400,
      `${label} ${required ? "is required and " : ""}must be text of at most ${max} characters.`,
    );
  return value.trim();
}
function id(value, label = "ID") {
  const result = parsePositiveInteger(value);
  if (!result) fail(400, `${label} must be a positive integer.`);
  return result;
}
function money(value, label = "Price") {
  if (
    !["string", "number"].includes(typeof value) ||
    !/^\d{1,10}(\.\d{1,2})?$/.test(String(value))
  )
    fail(
      400,
      `${label} must be a non-negative amount with at most two decimal places.`,
    );
  return String(value);
}
function url(value, label = "Image URL") {
  const result = string(value, label, 2000);
  if (result) {
    try {
      if (!["http:", "https:"].includes(new URL(result).protocol))
        throw new Error();
    } catch {
      fail(400, `${label} must be an http or https URL.`);
    }
  }
  return result;
}
function address(body) {
  return [
    string(body.street_address, "Street address", 500, true),
    string(body.postal_code, "Postal code", 30),
    string(body.city, "City", 100, true),
    string(body.state_province, "State/province", 100),
    string(body.country_id, "Country", 10, true),
  ];
}
function phone(value) {
  const result = string(value, "Phone", 20, true);
  if (!/^\+?[0-9 -]{7,20}$/.test(result))
    fail(400, "Enter a valid phone number.");
  return result;
}
module.exports = { fail, string, id, money, url, address, phone };
