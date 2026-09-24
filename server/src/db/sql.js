// Escapes the ILIKE metacharacters so a user typing "%" searches for a literal
// percent sign instead of matching everything.
//
// Shared by the storefront catalog and the admin console. Escaping is
// security-relevant, so it lives in one place: a second copy is how one of them
// ends up unfixed.
function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

module.exports = { escapeLikePattern };
