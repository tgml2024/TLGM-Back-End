const express = require("express");
const {
    getSandingGroup,
    postSandingGroup,
    deleteSandingGroup,
} = require("../controller/SandingGroupController");
const isUser = require('../middleware/userMiddleware');

const router = express.Router();

// Route for fetching Sending Groups
router.get("/sanding-group", isUser, getSandingGroup);

// Route for adding a new Sending Group
router.post("/sanding-group", isUser, postSandingGroup);

// Route for deleting a Sending Group
router.delete("/sanding-group", isUser, deleteSandingGroup);

module.exports = router;
