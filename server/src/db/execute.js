// How a statement reaches Oracle.
//
// Every query in the application passes through here, which makes this the one
// place that has to know the four things Oracle does differently from the
// PostgreSQL this code was written against.
//
//   * DML cannot RETURN a row. Oracle returns values into output bind variables,
//     so PostgreSQL's `RETURNING order_id, order_status` is rewritten to
//     `RETURNING order_id, order_status INTO :r0, :r1` and the output values are
//     turned back into the single row the caller was promised. A statement that
//     writes nothing returns no row — the same promise PostgreSQL made, and the
//     signal every compare-and-set in this project reads as "somebody got there
//     first".
//
//   * A numeric column arrives as a number, where node-pg handed back a string.
//     The client renders those strings directly ("$25.00"), so a NUMBER with
//     scale 2 is formatted back into a string at exactly the column's own scale.
//     The rule is the column's declared scale, not its name, so it follows the
//     schema rather than a list that could fall out of step with it. NUMBER(1)
//     is a boolean for the same reason: it is what the schema uses where
//     PostgreSQL said boolean, and the API has always spoken in true and false.
//
//   * A bind variable cannot stand for a list. PostgreSQL writes
//     `prod_id = ANY($1::int[])`; Oracle has no such form, so an array bind is
//     expanded into as many bind variables as the array has elements and the SQL
//     simply says `prod_id IN (:1)`. Callers still pass one array.
//
//   * A statement that decides something and reports it cannot be one statement.
//     Oracle's MERGE has no RETURNING, so the few upserts PostgreSQL wrote as
//     `INSERT ... ON CONFLICT ... RETURNING` arrive here as short PL/SQL blocks
//     instead. Such a block declares its output binds and leaves them untouched
//     when it writes nothing; all-null is reported as no row, which is again
//     what RETURNING would have said.
const oracledb = require("oracledb");
const { timedQuery } = require("./logger");

// node-pg hands a numeric(12,2) column back as a string at that scale. This is
// the same two places, and the same string.
const MONEY_SCALE = 2;

// =========================================================
// Column types
// =========================================================

// An output bind has to be told what it is holding, because there is no result
// set behind it to describe the column. The catalog is asked once per table and
// remembered: a schema does not change under a running server.
//
// The owner is read from the session rather than left to the USER_ view, which
// answers for the user the connection logged in as. The two are the same thing
// in every deployment, and they are not the same thing under ALTER SESSION SET
// CURRENT_SCHEMA — the only way this database has of aiming one connection at
// another schema, and what a regression test uses to point the application's
// queries at its own disposable one.

async function catalogFor(connection, table) {
  const name = table.toUpperCase();

  const result = await connection.execute(
    `SELECT column_name, data_type, data_precision, data_scale
     FROM all_tab_columns
     WHERE owner = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND table_name = :1
     ORDER BY column_id`,
    [name],
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );

  const columns = new Map();
  for (const column of result.rows) {
    columns.set(column.COLUMN_NAME, {
      type: bindTypeFor(column.DATA_TYPE),
      money: isMoney(column.DATA_TYPE, column.DATA_SCALE),
      boolean: isBoolean(column.DATA_TYPE, column.DATA_PRECISION, column.DATA_SCALE),
    });
  }
  return columns;
}

function isMoney(dataType, scale) {
  return dataType === "NUMBER" && Number(scale) === MONEY_SCALE;
}

// What this schema declares where PostgreSQL said boolean: NUMBER(1) with a
// CHECK that keeps it to 0 and 1.
function isBoolean(dataType, precision, scale) {
  return (
    dataType === "NUMBER" && Number(precision) === 1 && Number(scale) === 0
  );
}

// Only the types this schema actually stores. Anything else falls in as a
// varchar, which is what an unrecognised column would be readable as rather
// than a reason to refuse the statement.
function bindTypeFor(dataType) {
  switch (dataType) {
    case "NUMBER":
      return oracledb.DB_TYPE_NUMBER;
    case "DATE":
      return oracledb.DB_TYPE_DATE;
    case "TIMESTAMP(6)":
    case "TIMESTAMP(6) WITH TIME ZONE":
    case "TIMESTAMP(6) WITH LOCAL TIME ZONE":
      return oracledb.DB_TYPE_TIMESTAMP;
    case "CLOB":
      return oracledb.DB_TYPE_CLOB;
    default:
      return oracledb.DB_TYPE_VARCHAR;
  }
}

// =========================================================
// Statement text
// =========================================================

const RETURNING = /\bRETURNING\s+([^;]*?)\s*$/i;

// `UPDATE products p SET ...` / `INSERT INTO products ...` / `DELETE FROM
// products ...`, which is all this needs to find the catalog entry behind a
// RETURNING clause.
function targetTable(text) {
  const match = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][\w$#.]*)/i.exec(text);
  return match ? match[1] : null;
}

// `p.prod_id` and `prod_id AS id` both mean the column `prod_id` here: a
// RETURNING clause reads the row that was just written, so there is only one
// table for a qualifier to name, and Oracle will not take one.
function returningColumn(item) {
  const withoutAlias = item.replace(/\s+AS\s+[\w$#]+\s*$/i, "");
  const column = withoutAlias.trim().split(".").pop();
  if (!/^[\w$#]+$/.test(column))
    throw new Error(`Unsupported RETURNING expression in Oracle: "${item}".`);
  return column;
}

// The name the caller will read in the row. PostgreSQL labels a RETURNING column
// with its alias when it has one and with the column name otherwise, so the same
// rule is applied to the rewritten clause.
function returningLabel(item) {
  const aliased = /\s+AS\s+([\w$#]+)\s*$/i.exec(item);
  return (aliased ? aliased[1] : returningColumn(item)).toLowerCase();
}

// =========================================================
// Binds
// =========================================================

// A numbered bind is one PostgreSQL wrote as $n. The SQL now says :n, and the
// values still arrive as a positional array, so they are named here — binding by
// name is also what makes a bind used twice in one statement bind once, which
// PostgreSQL's $n did and a positional array would not.
function namedBinds(text, values) {
  const binds = {};
  let sql = text;

  values.forEach((value, index) => {
    const position = index + 1;
    if (!Array.isArray(value)) {
      binds[String(position)] = value;
      return;
    }

    // An empty list would leave `IN ()`, which Oracle cannot parse, and which
    // also cannot match anything — `IN (NULL)` is the honest spelling of a list
    // with nothing in it.
    if (value.length === 0) {
      sql = sql.replace(bindPattern(position), "NULL");
      return;
    }

    const names = value.map((element, offset) => {
      const name = `list${position}_${offset}`;
      binds[name] = element;
      return `:${name}`;
    });
    sql = sql.replace(bindPattern(position), names.join(", "));
  });

  return { sql, binds };
}

// `:1` must not be found inside `:10`, and must not be found inside a quoted
// string. The schema's own literals contain no colons, so the numeric guard is
// the whole of it.
function bindPattern(position) {
  return new RegExp(`:${position}(?![0-9])`, "g");
}

// A JavaScript boolean reaches Oracle as Oracle's own BOOLEAN type, which this
// database understands inside PL/SQL but not in the DML that writes these
// columns — where a boolean is NUMBER(1), the same thing the reader above turns
// back into true and false. Converting at the door is what makes the two halves
// of that agreement meet, so every caller may keep speaking in booleans
// whichever way it is talking to the database.
//
// An object among the binds is a bind unit of the caller's (`{dir, type, val}`),
// not a value to convert, so only plain values and the elements of an array bind
// are touched.
function bindValues(binds) {
  for (const name of Object.keys(binds)) {
    const value = binds[name];
    if (typeof value === "boolean") binds[name] = Number(value);
    else if (Array.isArray(value))
      binds[name] = value.map((element) =>
        typeof element === "boolean" ? Number(element) : element,
      );
  }
  return binds;
}

// =========================================================
// Results
// =========================================================

// A table's declared column, by the name the row carries it under. A column
// selected from a table is described by the catalog above; one that is the
// result of an expression is described by the driver, which reports the same
// precision and scale for a NUMBER(1) or a NUMBER(12,2) wherever it came from.
function columnPlan(metaData, columns) {
  return metaData.map((column) => {
    const declared = columns ? columns.get(column.name.toUpperCase()) : null;
    const numbers = column.dbType === oracledb.DB_TYPE_NUMBER;
    return {
      read: column.name,
      write: column.name.toLowerCase(),
      money: declared ? declared.money : numbers && column.scale === MONEY_SCALE,
      boolean: declared
        ? declared.boolean
        : numbers && column.precision === 1 && column.scale === 0,
    };
  });
}

function shapeRow(row, plan) {
  const shaped = {};
  for (const column of plan) {
    const value = row[column.read];
    if (value === null || value === undefined) shaped[column.write] = null;
    else if (column.boolean) shaped[column.write] = Number(value) === 1;
    else if (column.money) shaped[column.write] = Number(value).toFixed(MONEY_SCALE);
    else shaped[column.write] = value;
  }
  return shaped;
}

// =========================================================
// Running
// =========================================================

function isPlSql(text) {
  return /^\s*(?:BEGIN|DECLARE)\b/i.test(text);
}

// A PL/SQL block carries its own output binds, named by the caller, and reports
// a row exactly when one of them holds a value: the block writes nothing and
// leaves them null, which is what RETURNING would have reported as no row.
//
// Only the binds the caller declared as output become the row. A block also
// receives its inputs as binds — that is the only way PL/SQL is given a value —
// and those are not part of the answer.
function plSqlRow(outBinds, binds) {
  if (!outBinds) return [];
  // Matched case-insensitively and renamed back to what the caller declared, so
  // a row's fields are named by the query module rather than by however the
  // driver happened to hand them back.
  const declared = new Map(
    Object.keys(binds ?? {})
      .filter((name) => binds[name]?.dir === oracledb.BIND_OUT)
      .map((name) => [name.toLowerCase(), name]),
  );

  const row = {};
  let answered = false;
  for (const [name, value] of Object.entries(outBinds)) {
    const field = declared.get(name.toLowerCase());
    if (!field) continue;
    row[field] = value ?? null;
    if (value !== null && value !== undefined) answered = true;
  }
  return answered ? [row] : [];
}

async function execute(connection, text, values, { autoCommit = false } = {}) {
  if (typeof text === "object") {
    values = values ?? text.values;
    text = text.text;
  }
  if (isPlSql(text)) {
    const binds = bindValues({ ...values });
    const result = await connection.execute(text, binds, {
      autoCommit,
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    const rows = plSqlRow(await readLobs(result.outBinds), binds);
    return { rows, rowCount: result.rowsAffected ?? rows.length };
  }

  const returning = RETURNING.exec(text);
  const binds = Array.isArray(values) || values === undefined
    ? namedBinds(text, values ?? [])
    : { sql: text, binds: values };

  let sql = binds.sql;
  const plan = [];

  if (returning) {
    const table = targetTable(sql);
    if (!table) throw new Error("A RETURNING clause needs a table to read back.");
    const columns = await catalogFor(connection, table);

    // `RETURNING *` reads the whole row back. Oracle will no more take the star
    // here than it will take a table qualifier, so it is expanded into the
    // table's own column list, in declaration order — which is the order, and
    // the names, PostgreSQL would have answered in.
    const requested = returning[1].trim();
    const labels = /^(\*|[\w$#]+\.\*)$/.test(requested)
      ? [...columns.keys()]
      : requested.split(",").map((item) => item.trim());
    const names = labels.map((item, index) => {
      const column = returningColumn(item);
      const declared = columns.get(column.toUpperCase());
      if (!declared)
        throw new Error(`RETURNING ${column} does not name a column of ${table}.`);
      const name = `ret${index}`;
      binds.binds[name] = { dir: oracledb.BIND_OUT, type: declared.type,
        ...(declared.type === oracledb.DB_TYPE_VARCHAR ? { maxSize: 32767 } : {}) };
      plan.push({
        read: name,
        write: returningLabel(item),
        money: declared.money,
        boolean: declared.boolean,
      });
      return `:${name}`;
    });

    // The clause is rebuilt rather than kept: the INTO list is what carries the
    // values back, and Oracle will not take a table qualifier in it.
    sql = `${sql.slice(0, RETURNING.exec(sql).index)}RETURNING ${labels
      .map(returningColumn)
      .join(", ")} INTO ${names.join(", ")}`;
  }

  // Oracle does not support INSERT ... SELECT ... RETURNING. These application
  // queries insert at most one row; select into typed locals, then use VALUES.
  let scalarReturning = false;
  const insertSelect = returning && /^\s*INSERT INTO (\w+)\s*\(([^)]+)\)\s*(SELECT[\s\S]+)\s+RETURNING\s+([\s\S]+)$/i.exec(sql);
  if (insertSelect) {
    const [, table, fields, select, output] = insertSelect;
    const columns = fields.split(",").map((field) => field.trim());
    const locals = columns.map((_, i) => `input${i}`);
    const types = await catalogFor(connection, table);
    const projection = columns.map((column) => types.get(column.toUpperCase())?.type === oracledb.DB_TYPE_CLOB
      ? `TO_CLOB(${column})` : column);
    sql = `DECLARE ${columns.map((column, i) => `${locals[i]} ${table}.${column}%TYPE;`).join("\n")}
      BEGIN
        WITH source_row (${columns.join(", ")}) AS (${select})
        SELECT ${projection.join(", ")} INTO ${locals.join(", ")} FROM source_row;
        INSERT INTO ${table} (${fields}) VALUES (${locals.join(", ")}) RETURNING ${output};
      EXCEPTION WHEN NO_DATA_FOUND THEN NULL;
      END;`;
    scalarReturning = true;
  }

  let result;
  try {
    result = await connection.execute(sql, bindValues(binds.binds), {
      autoCommit,
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
  } catch (error) {
    // An INTO list that matched nothing is Oracle's way of saying what an empty
    // RETURNING said. Every compare-and-set in this project — the order claim,
    // the return pickup, cancelling, removing a listing — reads "no row" as
    // "somebody else got there first" and turns it into a 409, so the missing
    // row has to arrive as an empty result rather than as a failure.
    if (returning && error.errorNum === 1403)
      return { rows: [], rowCount: 0 };
    throw error;
  }

  let rows;
  if (returning) {
    const output = await readLobs(result.outBinds || {});
    const count = scalarReturning ? (output.ret0 == null ? 0 : 1) : result.rowsAffected || 0;
    rows = Array.from({ length: count }, (_, index) => shapeRow(
      Object.fromEntries(Object.entries(output).map(([key, value]) =>
        [key, scalarReturning ? value : value[index]])), plan));
  } else rows = (result.rows ?? []).map((row) =>
        shapeRow(row, columnPlan(result.metaData ?? [], null)),
      );

  return { rows, rowCount: rowCount(result, rows) };
}

async function readLobs(values = {}) {
  const read = async (value) => Array.isArray(value)
    ? Promise.all(value.map(read))
    : value && typeof value.getData === "function" ? value.getData() : value;
  return Object.fromEntries(await Promise.all(Object.entries(values).map(async ([key, value]) =>
    [key, await read(value)])));
}

// How many rows the caller hears about, which pg reported as the rows a write
// touched and, for a read, the rows it returned. Oracle answers only the first
// half — rowsAffected is 0 for every SELECT — so a read that found rows would
// otherwise be reported as a read that found none, and every assertion of the
// form "no row matches this contradiction" would hold whatever the database
// said. Whichever half is non-zero is the true count: a statement that returned
// rows affected none, and one that affected rows returned none.
function rowCount(result, rows) {
  return result.rowsAffected || rows.length;
}

// What the logger times. It calls `runner.query`, so the translation sits one
// level below it and statement logging keeps reporting the text the caller
// wrote rather than the rewritten Oracle form.
function runnerFor(oracleConnection, options) {
  return Object.create(null, {
    query: {
      value: (text, values) => execute(oracleConnection, text, values, options),
    },
  });
}

// One statement and its own commit, which is what an untransacted query has
// always meant here: pg's pool ran each statement in autocommit.
async function pooledQuery(oracleConnection, text, values) {
  return timedQuery(runnerFor(oracleConnection, { autoCommit: true }), text, values);
}

// A connection held open across several statements. Oracle begins a transaction
// at the first statement that writes, and ends it at commit or rollback, so a
// session is nothing more than the connection plus the two ways to end it.
function session(oracleConnection) {
  return {
    query: (text, values) =>
      timedQuery(runnerFor(oracleConnection, {}), text, values),
    commit: () => oracleConnection.commit(),
    rollback: () => oracleConnection.rollback(),
    close: () => oracleConnection.close(),
  };
}

module.exports = { pooledQuery, session };
