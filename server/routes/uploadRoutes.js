const express = require("express");
const fs = require("fs");
const path = require("path");
const { protect } = require("../middleware/auth");

const router = express.Router();
const uploadDir = path.join(__dirname, "../uploads");
const validTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

function saveImage(image, field) {
  if (!image) return null;
  const match = image.match(
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match || !validTypes.has(match[1]))
    throw new Error(`${field} must be a PNG, JPEG, or WebP image.`);
  const fileName = `${Date.now()}-${field}${validTypes.get(match[1])}`;
  fs.writeFileSync(
    path.join(uploadDir, fileName),
    Buffer.from(match[2], "base64"),
  );
  return `/uploads/${fileName}`;
}

router.post("/templates", protect, (req, res, next) => {
  try {
    res.json({
      logo: saveImage(req.body.logo, "logo"),
      cover: saveImage(req.body.cover, "cover"),
    });
  } catch (error) {
    next(error);
  }
});
module.exports = router;
