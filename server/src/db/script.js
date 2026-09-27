// SQL*Plus slash delimiters separate statements; PL/SQL retains its final ';'.
function statements(sql) {
  return sql.split(/^\s*\/\s*$/m).map((chunk) => chunk
    .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean).map((sql) => /^(CREATE\s+(OR REPLACE\s+)?(TRIGGER|FUNCTION|PROCEDURE)|BEGIN|DECLARE)\b/i.test(sql)
      ? sql : sql.replace(/;\s*$/, ""));
}

async function assertValidObjects(client) {
  const { rows } = await client.query(`SELECT name, type, line, position, text
    FROM all_errors WHERE owner=SYS_CONTEXT('USERENV','CURRENT_SCHEMA')
      AND attribute='ERROR' ORDER BY name, sequence`);
  if (rows.length) throw new Error(rows.map((row) =>
    `${row.type} ${row.name}:${row.line}:${row.position}: ${row.text}`).join("\n"));
}

module.exports = { statements, assertValidObjects };
