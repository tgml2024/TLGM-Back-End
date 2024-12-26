const express = require("express");
const {
    getResiveGroup,
    postResiveGroup,
    deleteResiveGroup,
    getChannels
} = require("../controller/ResiveGroupController");

const router = express.Router();

router.get("/resive-group", getResiveGroup); // GET route for fetching groups
router.post("/resive-group", postResiveGroup); // POST route for adding groups
router.delete("/resive-group/:rg_id", deleteResiveGroup); // DELETE route for removing groups
router.post("/channels", getChannels);

module.exports = router;
