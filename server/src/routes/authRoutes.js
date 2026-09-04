const express = require("express");
const { login, logout, me, register } = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/auth/register", register);
router.post("/auth/login", login);
router.post("/auth/logout", requireAuth, logout);
router.get("/auth/me", requireAuth, me);

// Temporary aliases keep the current static pages working during the React migration.
router.post("/signup", register);
router.post("/login", login);

module.exports = router;
