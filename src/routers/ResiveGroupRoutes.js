const express = require("express");
const {
    getResiveGroup,
    postResiveGroup,
    deleteResiveGroup,
    getChannels
} = require("../controller/ResiveGroupController");
const isUser = require('../middleware/userMiddleware');

const router = express.Router();

router.get("/resive-group", isUser, getResiveGroup); // GET route for fetching groups
router.post("/resive-group", isUser, postResiveGroup); // POST route for adding groups
router.delete("/resive-group", isUser, deleteResiveGroup); // DELETE route for removing multiple groups
router.post("/channels", isUser, getChannels);

module.exports = router;
