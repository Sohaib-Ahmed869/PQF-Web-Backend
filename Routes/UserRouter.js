const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  // Registration functions
  registerCustomer,
  registerBusiness,
  createAdmin,
  registerSuperAdmin,
  
  // Authentication
  login,
  
  // Profile management
  getProfile,
  updateProfile,
  updateTermsAgreement,
  
  // User management (Admin functions)
  getAllUsers,
  getUserById,
  updateUserStatus,
  deleteUser,
  getAdmins,
  updateDocumentVerification,
  
  // Address management
  addAddress,
  getAddresses,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  setShippingAndBillingSame,
  getUserAddress,
  
  // Wishlist management
  addToWishlist,
  removeFromWishlist,
  getWishlist
} = require('../Controllers/UserController');

const { protect, requireSuperAdmin, requireAdmin } = require("../Middleware/Authentication");
const { documentUpload } = require('../Config/S3');

// Error handling middleware for multer
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error('Multer error:', error);
    return res.status(400).json({
      success: false,
      message: 'File upload error: ' + error.message
    });
  } else if (error) {
    console.error('Upload error:', error);
    return res.status(400).json({
      success: false,
      message: 'File upload error: ' + error.message
    });
  }
  next();
};

// =============================================================================
// PUBLIC ROUTES (No authentication required)
// =============================================================================

// CUSTOMER REGISTRATION - Single step
router.post('/register/customer', registerCustomer);

// BUSINESS REGISTRATION - Single API with multi-step logic
router.post('/register/business', documentUpload, handleMulterError, registerBusiness);

// SUPER ADMIN REGISTRATION - First super admin or by existing super admin
router.post('/register/super-admin', registerSuperAdmin);

// LOGIN
router.post('/login', login);

// =============================================================================
// AUTHENTICATED USER ROUTES (All authenticated users)
// =============================================================================

// PROFILE MANAGEMENT
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.put('/terms-agreement', protect, updateTermsAgreement);

// ADDRESS MANAGEMENT ROUTES
router.post('/address', protect, addAddress); 
router.get('/address', protect, getAddresses); 
router.put('/address/:addressId', protect, updateAddress);
router.delete('/address/:addressId', protect, deleteAddress);
router.put('/address/default/:type', protect, setDefaultAddress); 
router.put('/address/set-both', protect, setShippingAndBillingSame); 
router.get('/address/get', protect, getUserAddress);

// WISHLIST ROUTES
router.post('/wishlist/add', protect, addToWishlist);
router.post('/wishlist/remove', protect, removeFromWishlist);
router.get('/wishlist', protect, getWishlist);

// =============================================================================
// ADMIN ROUTES (Admin and Super Admin access)
// =============================================================================

// USER MANAGEMENT
router.get('/users', protect, requireAdmin, getAllUsers);
router.get('/users/:id', protect, requireAdmin, getUserById);
router.put('/users/:id/status', protect, requireAdmin, updateUserStatus);
router.delete('/users/:id', protect, requireAdmin, deleteUser);
router.get('/admins', protect, requireAdmin, getAdmins);
router.put('/users/:userId/document-verification', protect, requireAdmin, updateDocumentVerification);

// =============================================================================
// SUPER ADMIN ONLY ROUTES
// =============================================================================

// ADMIN CREATION
router.post('/create-admin', protect, requireSuperAdmin, createAdmin);

module.exports = router;