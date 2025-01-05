const express = require('express');
const router = express.Router();
const ProfileController = require('../controller/ProfileController');
const authenticateToken = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/adminMiddleware');
const isUser = require('../middleware/userMiddleware');
// Protected routes - require authentication
router.use(authenticateToken);

// Route for getting own profile (all users)
router.get('/userProfile', isUser, ProfileController.getUserProfile);

// Admin only routes
router.get('/adminProfile', isAdmin, ProfileController.getAdminProfile);

// Update profile
router.put('/updateProfile', isUser, ProfileController.updateProfile);

module.exports = router; 