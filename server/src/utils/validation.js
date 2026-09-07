// PostgreSQL INT is a signed 32-bit integer. Reject coercions such as true → 1.
function parsePositiveInteger(value) {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^[1-9]\d*$/.test(value))
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2147483647
    ? number
    : null;
}

module.exports = { parsePositiveInteger };
