// Colour for the diagnostic loggers, and the rule for when to leave it out.
//
// It is a property of where the output is going, so it is off wherever that is
// not a terminal: a pipe into a file, or the integration suites, which capture
// these lines and match on their text. NO_COLOR turns it off as well, which is
// the convention every other tool on the machine already honours. Read per call
// rather than cached at require time, for the same reason logging.js is: a
// process that redirects its own output should still be obeyed.
//
// Four colours and a dim, and no more. A tag, a status, a failure: the log is
// meant to stay scannable, and everything lit is nothing lit.
function enabled() {
  return (
    !process.env.NO_COLOR &&
    Boolean(process.stdout.isTTY || process.stderr.isTTY)
  );
}

function paint(code, text) {
  return enabled() ? `\u001b[${code}m${text}\u001b[0m` : String(text);
}

// The [sql] and [api] tag, the same colour in both so a line is recognisable
// before it is read.
const cyan = (text) => paint(36, text);
// Timings and other detail that is there when looked for and quiet when not.
const dim = (text) => paint(2, text);
const green = (text) => paint(32, text);
const yellow = (text) => paint(33, text);
const red = (text) => paint(31, text);

// A response status, coloured by what it asks of the reader: nothing for a
// success, a look for a refusal, attention for a failure.
function status(code) {
  if (code >= 500) return red(code);
  if (code >= 400) return yellow(code);
  return green(code);
}

module.exports = { cyan, dim, green, red, status, yellow };
