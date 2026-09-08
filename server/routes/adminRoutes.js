const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Project = require("../models/Project");
const { protect, isAdmin } = require("../middleware/auth");

const router = express.Router();

const createAdminToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: "admin" },
    process.env.JWT_SECRET || "development-secret",
    { expiresIn: "7d" }
  );

// 1. Admin Login Endpoint - requires Email/ID, Password, AND .env Credential Key
router.post("/login", async (req, res, next) => {
  try {
    const { email, adminId, password, credentialKey, adminKey, secretKey } = req.body;
    const cleanEmail = String(email || adminId || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    const cleanKey = String(credentialKey || adminKey || secretKey || "").trim();

    if (!cleanEmail || !cleanPassword || !cleanKey) {
      return res.status(400).json({
        message: "Admin Email/ID, Password, and Secret Credential Key are all required."
      });
    }

    const envKey = String(process.env.ADMIN_CREDENTIAL_KEY || "").trim();
    if (!envKey || cleanKey !== envKey) {
      return res.status(403).json({
        message: "Access Forbidden: Invalid Admin Credential Key."
      });
    }

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(403).json({
        message: "Access Forbidden: Invalid administrator credentials."
      });
    }

    const isMatch = await bcrypt.compare(cleanPassword, user.password);
    if (!isMatch) {
      return res.status(403).json({
        message: "Access Forbidden: Invalid administrator credentials."
      });
    }

    // Elevate user role to admin upon validated secret credential key
    if (user.role !== "admin") {
      user.role = "admin";
      await user.save();
    }

    const token = createAdminToken(user);
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: "admin",
      },
      message: "Administrator verification successful."
    });
  } catch (error) {
    next(error);
  }
});

// All subsequent admin routes require valid admin session token
router.use(protect, isAdmin);

router.get("/stats", async (_req, res, next) => {
  try {
    const [users, reports] = await Promise.all([
      User.countDocuments(),
      Project.countDocuments(),
    ]);
    res.json({ users, reports, apiRequests: reports * 14, prompts: 14 });
  } catch (error) {
    next(error);
  }
});

router.get("/users", async (_req, res, next) => {
  try {
    // Strictly exclude password hashes
    const users = await User.find().select("-password").sort("-createdAt");

    // Aggregate user project counts to compute total API / request metrics
    const userProjects = await Project.aggregate([
      { $group: { _id: "$owner", projectCount: { $sum: 1 } } }
    ]);
    const projectMap = {};
    userProjects.forEach((p) => {
      projectMap[String(p._id)] = p.projectCount;
    });

    const enrichedUsers = users.map((u) => {
      const pCount = projectMap[String(u._id)] || 0;
      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        projectCount: pCount,
        apiRequests: pCount * 14,
        createdAt: u.createdAt,
      };
    });

    res.json(enrichedUsers);
  } catch (error) {
    next(error);
  }
});

router.patch("/users/:id/role", async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!["user", "admin"].includes(role)) {
      return res.status(400).json({ message: "Role must be 'user' or 'admin'." });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true },
    ).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.patch("/users/:id/password", async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long." });
    }
    if (!/[^a-zA-Z0-9]/.test(password)) {
      return res.status(400).json({ message: "Password must contain at least one special symbol." });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { password: hashedPassword },
      { new: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found with this ID." });
    }
    res.json({ message: `Password for ${user.email} updated successfully.`, user });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
