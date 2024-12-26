const express = require("express");
const { refreshToken } = require("../controller/RefreshTokenController");

const router = express.Router();

// Route สำหรับรีเฟรช access token
router.post("/refresh-token", refreshToken);

module.exports = router;
