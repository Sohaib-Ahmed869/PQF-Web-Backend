const express = require('express');
const router = express.Router();
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
} = require('../Controllers/UserController');
const { protect, requireSuperAdmin } = require("../Middleware/Authentication");

// PUBLIC ROUTES (No authentication required)
router.post('/register',register);
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
router.get('/getAllUsers', protect, requireSuperAdmin, getAllUsers);
router.get('/getIndividual/:id', protect, requireSuperAdmin, getUserById);
router.put('/:id/status', protect, requireSuperAdmin, updateUserStatus);
router.delete('/delete/:id', protect, requireSuperAdmin, deleteUser);
router.get('/getAdmins', protect, requireSuperAdmin, getAdmins);

module.exports = router;