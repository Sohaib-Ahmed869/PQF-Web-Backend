const express = require('express');
const router = express.Router();
const PromotionController = require('../Controllers/PromotionController');
const { protect } = require('../Middleware/Authentication');

// Public routes (no authentication required)
// Get public promotions for a store
router.get('/public', async (req, res) => {
  return PromotionController.getPublicPromotions(req, res);
});

// Apply authentication middleware to protected routes
router.use(protect);

// Create a new promotion (Admin/SuperAdmin only)
router.post('/create', async (req, res) => {
  // Check if user has admin privileges
  if (req.user.role !== 'admin' && req.user.role !== 'superAdmin') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Admin privileges required.'
    });
  }
  
  return PromotionController.createPromotion(req, res);
});

// Get all promotions for a store
router.get('/', async (req, res) => {
  // Check if user has admin privileges or is requesting their own store's promotions
  if (req.user.role !== 'admin' && req.user.role !== 'superAdmin') {
    // If not admin, only allow access to promotions for user's store
    if (req.user.assignedStore) {
      // Handle both cases: assignedStore as object with _id or as string
      const storeId = req.user.assignedStore._id || req.user.assignedStore;
      if (storeId) {
        req.query.store = storeId;
      } else {
        return res.status(403).json({
          success: false,
          error: 'Access denied. Admin privileges required.'
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
  }
  
  return PromotionController.getPromotions(req, res);
});

// Get applicable promotions for a cart (All authenticated users)
router.get('/applicable/cart', async (req, res) => {
  return PromotionController.getApplicablePromotions(req, res);
});

// Apply promotion to cart (All authenticated users)
router.post('/apply-to-cart', async (req, res) => {
  return PromotionController.applyPromotionToCart(req, res);
});

// Validate promotion code (All authenticated users)
router.post('/validate-code', async (req, res) => {
  return PromotionController.validatePromotionCode(req, res);
});

// Get consumed promotions for a user (All authenticated users)
router.get('/user/consumed', async (req, res) => {
  return PromotionController.getUserConsumedPromotions(req, res);
});

// Get promotion statistics (Admin/SuperAdmin only)
router.get('/:id/stats', async (req, res) => {
  // Check if user has admin privileges
  if (req.user.role !== 'admin' && req.user.role !== 'superAdmin') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Admin privileges required.'
    });
  }
  
  return PromotionController.getPromotionStats(req, res);
});

// Get a specific promotion
router.get('/:id', async (req, res) => {
  // Check if user has admin privileges or is requesting their own store's promotion
  if (req.user.role !== 'admin' && req.user.role !== 'superAdmin') {
    // If not admin, only allow access to promotions for user's store
    if (req.user.assignedStore) {
      req.query.store = req.user.assignedStore;
    } else {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
  }
  
  return PromotionController.getPromotion(req, res);
});

// Update a promotion (Admin/SuperAdmin only)
router.put('/:id', async (req, res) => {
  // Check if user has admin privileges
  if (req.user.role !== 'admin' && req.user.role !== 'superAdmin') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Admin privileges required.'
    });
  }
  
  return PromotionController.updatePromotion(req, res);
});

// Delete a promotion (Admin/SuperAdmin only)
router.delete('/:id', async (req, res) => {
  // Check if user has admin privileges
  if (req.user.role !== 'admin' && req.user.role !== 'superAdmin') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Admin privileges required.'
    });
  }
  
  return PromotionController.deletePromotion(req, res);
});

module.exports = router; 