const express = require('express');
const router = express.Router();
const WebController = require('../../Controllers/Website/WebController');
const OrderController = require('../../Controllers/Website/OrderController');
const { protect } = require('../../Middleware/Authentication');
const { reorder } = require('../../Controllers/Website/OrderController');

// Public routes
router.get('/banners/active', WebController.getActiveBannersByStore);
router.get('/categories/active', WebController.getActiveCategoriesByStore);
router.get('/stores/active', WebController.getActiveStores);
router.get('/products/active/top3', WebController.getFeaturedProducts);
router.get('/products/active', WebController.getActiveProductsByStore);
router.get('/products/active/by-store-category', WebController.getActiveProductsByStoreAndCategory);
router.get('/products/suggest-names', WebController.suggestProductNames);
router.get('/products/search', WebController.searchProducts);
router.get('/products/:id', WebController.getProductById);
// Get current user's orders
router.get('/orders/my', protect, OrderController.getUserOrders);
router.get('/orders/:orderId', protect, OrderController.getOrderDetails);
router.get('/orders/:orderId/tracking', protect, OrderController.getOrderTracking);
router.patch('/orders/:orderId/tracking', protect, OrderController.updateOrderTracking);
router.post('/orders/:orderId/reorder', protect, reorder);
router.get('/orders/:orderId/receipt', protect, OrderController.viewReceipt);

// Get current user's recurring orders
router.get('/orders/recurring/my', protect, OrderController.getCustomerRecurringOrders);

// Get current user's abandoned carts
router.get('/cart/abandoned/my', protect, WebController.getUserAbandonedCarts);
router.post('/cart/abandoned/:cartId/reorder', protect, WebController.reorderAbandonedCart);


module.exports = router;
