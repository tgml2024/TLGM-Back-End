const express = require("express");
const {
    getSandingGroup,
    postSandingGroup,
    deleteSandingGroup,
} = require("../controller/SandingGroupController");

const authenticateToken = require('../middleware/authMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
const router = express.Router();
router.use(authenticateToken);
router.use(isUser);

// Route for fetching Sending Groups
router.get("/sanding-group", isUser, getSandingGroup);

// Route for adding a new Sending Group
router.post("/sanding-group", isUser, postSandingGroup);

// Route for deleting a Sending Group
router.delete("/sanding-group", isUser, deleteSandingGroup);

module.exports = router;
