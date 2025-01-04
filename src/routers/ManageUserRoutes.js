const express = require('express');
const router = express.Router();
const ManageUserController = require('../controller/ManageUserController');
const manageUserController = new ManageUserController();

// เส้นทางสำหรับการ register
router.get('/admin-users', manageUserController.getAdminUsers);

module.exports = router;
