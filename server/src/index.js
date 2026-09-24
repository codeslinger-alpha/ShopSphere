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

const configuredOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
// Unset or blank means local development, not "no browser may call the API".
const allowedOrigins = configuredOrigins.length
  ? configuredOrigins
  : ["http://localhost:5173"];

app.use(requestLogger);
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", catalogRoutes);
app.use("/api", roleRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found." });
});

app.use(errorHandler);

// Importing the app in regression tests should not start a second server.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
