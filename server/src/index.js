require("dotenv").config({
  path: require("node:path").join(__dirname, "../.env"),
  quiet: true,
});

const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const cartRoutes = require("./routes/cartRoutes");
const catalogRoutes = require("./routes/catalogRoutes");
const orderRoutes = require("./routes/orderRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const roleRoutes = require("./routes/roleRoutes");
const { errorHandler } = require("./middleware/errorMiddleware");
const { requestLogger } = require("./middleware/requestLogger");

const app = express();
const PORT = process.env.PORT || 5000;

// A browser only accepts a response when Access-Control-Allow-Origin names its
// own origin exactly, and credentials rule out a wildcard. An exact string
// comparison therefore means "localhost" and "127.0.0.1" are different sites, and
// opening the app at the wrong one makes every request look like a dead server.
// A list lets the app be served from any of its local addresses.
const configuredOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
// Unset or blank means local development, not "no browser may call the API".
const allowedOrigins = configuredOrigins.length
  ? configuredOrigins
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) =>
      // Requests with no Origin header (curl, same-origin, server-to-server)
      // have nothing to grant and nothing to protect; refusing them would break
      // every non-browser client for no benefit.
      !origin || allowedOrigins.includes(origin)
        ? callback(null, true)
        : // Omit the header rather than erroring. The browser blocks the response
          // either way, but an error would also fail the request for the
          // non-browser clients that never needed CORS in the first place.
          callback(null, false),
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
// First, so it also records the requests that never reach a route: a 401 from a
// guard, a malformed body, or a URL with no handler all still print a line.
app.use(requestLogger);

app.use("/api/auth", authRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", catalogRoutes);
app.use("/api", roleRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found." }); // 404 Not Found: the requested route or record could not be found.
});

app.use(errorHandler);

// Importing the app in regression tests should not start a second server.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
