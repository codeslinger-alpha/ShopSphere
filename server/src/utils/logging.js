// One rule behind every diagnostic switch: an explicit environment variable wins,
// otherwise diagnostics are on wherever NODE_ENV is not production. Stating that
// separately in each logger would let the three drift apart.
//
// Read per call rather than cached at require time: dotenv has usually run by
// then, but a script that sets a variable after loading a module should still be
// obeyed.
function loggingEnabled(name) {
  const explicit = process.env[name];
  if (explicit) return explicit !== "false";
  return process.env.NODE_ENV !== "production";
}

module.exports = { loggingEnabled };
