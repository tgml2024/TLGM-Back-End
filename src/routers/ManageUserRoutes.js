const express = require('express');
const router = express.Router();
const ManageUserController = require('../controller/ManageUserController');
const manageUserController = new ManageUserController();
const isAdmin = require('../middleware/adminMiddleware');

// เส้นทางสำหรับการ register
router.get('/admin-users', isAdmin, manageUserController.getAdminUsers);
router.put('/update-user-status', isAdmin, manageUserController.updateUserStatus);

module.exports = router;
