require("dotenv").config({
  path: require("node:path").join(__dirname, "../.env"),
  quiet: true,
});

const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const authRoutes = require("./routes/authRoutes");
const cartRoutes = require("./routes/cartRoutes");
const catalogRoutes = require("./routes/catalogRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const roleRoutes = require("./routes/roleRoutes");
const { errorHandler } = require("./middleware/errorMiddleware");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/wishlist", wishlistRoutes);
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
