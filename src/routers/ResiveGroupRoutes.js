const express = require("express");
const {
    getResiveGroup,
    postResiveGroup,
    deleteResiveGroup,
    getChannels
} = require("../controller/ResiveGroupController");
const authenticateToken = require('../middleware/authMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
const router = express.Router();
router.use(authenticateToken);
router.use(isUser);


router.get("/resive-group", isUser, getResiveGroup); // GET route for fetching groups
router.post("/resive-group", isUser, postResiveGroup); // POST route for adding groups
router.delete("/resive-group", isUser, deleteResiveGroup); // DELETE route for removing multiple groups
router.post("/channels", isUser, getChannels);

module.exports = router;
