const express = require("express");
const {
    getSandingGroup,
    postSandingGroup,
    deleteSandingGroup,
} = require("../controller/SandingGroupController");

const router = express.Router();

// Route for fetching Sending Groups
router.get("/sanding-group", getSandingGroup);

// Route for adding a new Sending Group
router.post("/sanding-group", postSandingGroup);

// Route for deleting a Sending Group
router.delete("/sanding-group", deleteSandingGroup);

module.exports = router;
