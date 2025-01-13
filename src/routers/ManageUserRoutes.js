const express = require('express');
const ManageUserController = require('../controller/ManageUserController');
const manageUserController = new ManageUserController();

const authenticateToken = require('../middleware/authMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
const router = express.Router();
router.use(authenticateToken);
router.use(isUser);

// เส้นทางสำหรับการ register
router.get('/admin-users', isUser, manageUserController.getAdminUsers);

module.exports = router;
