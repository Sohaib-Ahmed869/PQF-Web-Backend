const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  getAllUsers,
  getUserById,
  updateUserStatus,
  deleteUser,
  register,
  login,
  getProfile,
  updateProfile,
  updateTermsAgreement,
  getAdmins,
  addAddress,
  getAddresses,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  setShippingAndBillingSame,
  getUserAddress,
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  updateDocumentVerification,
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

// PUBLIC ROUTES (No authentication required)
router.post('/register', documentUpload, handleMulterError, register);
router.post('/login', login);

// AUTHENTICATED USER ROUTES (All authenticated users)

router.get('/getProfile', protect, getProfile);
router.put('/updateProfile', protect, updateProfile);
router.put('/updateTermsAgreement', protect, updateTermsAgreement);

// ADDRESS MANAGEMENT ROUTES
router.post('/Add', protect, addAddress); 
router.get('/getAll', protect, getAddresses); 
router.put('/update/:addressId', protect, updateAddress);
router.delete('/delete/address/:addressId', protect, deleteAddress);
router.put('/address/default/:type', protect, setDefaultAddress); 
router.put('/address/set-both', protect, setShippingAndBillingSame); 
router.get('/address', protect, getUserAddress);

// WISHLIST ROUTES
router.post('/wishlist/add', protect, addToWishlist);
router.post('/wishlist/remove', protect, removeFromWishlist);
router.get('/wishlist', protect, getWishlist);

// SUPER ADMIN ONLY ROUTES

router.post('/create-admin', protect, requireSuperAdmin, register);
router.get('/getAllUsers', protect, requireAdmin, getAllUsers);
router.get('/getIndividual/:id', protect, requireAdmin, getUserById);
router.put('/:id/status', protect, requireAdmin, updateUserStatus);
router.delete('/delete/:id', protect, requireAdmin, deleteUser);
router.get('/getAdmins', protect, requireAdmin, getAdmins);
router.put('/:userId/document-verification', protect, requireAdmin, updateDocumentVerification);

module.exports = router;