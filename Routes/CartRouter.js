const express = require('express');
const router = express.Router();
const CartController = require('../Controllers/CartController');
const authenticate = require('../Middleware/Authentication');

// All routes require authentication
router.use(authenticate.protect);

// Get current user's cart
router.get('/', CartController.getCart);

// Add item to cart
router.post('/add', CartController.addItem);

// Remove item from cart
router.post('/remove', CartController.removeItem);

// Update item quantity
router.post('/update', CartController.updateItem);

// Clear cart
router.post('/clear', CartController.clearCart);

// Sync guest cart with user cart
router.post('/sync', CartController.syncGuestCart);

// Promotion-related routes
router.post('/apply-promotion', CartController.applyPromotion);
router.get('/applicable-promotions', CartController.getApplicablePromotions);

// List abandoned carts (admin only - add admin middleware as needed)
router.get('/abandoned', CartController.listAbandoned);

module.exports = router;