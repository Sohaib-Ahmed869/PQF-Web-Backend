const express = require('express');
const router = express.Router();
const WebController = require('../../Controllers/Website/WebController');
const OrderController = require('../../Controllers/Website/OrderController');
const { protect } = require('../../Middleware/Authentication');
const { reorder } = require('../../Controllers/Website/OrderController');

router.get('/banners/active', WebController.getActiveBannersByStore);
router.get('/categories/active', WebController.getActiveCategoriesByStore);
router.get('/stores/active', WebController.getActiveStores);
router.get('/products/active/top3', WebController.getTop3ActiveProductsByStore);
router.get('/products/active', WebController.getActiveProductsByStore);
router.get('/products/active/by-store-category', WebController.getActiveProductsByStoreAndCategory);
router.get('/products/suggest-names', WebController.suggestProductNames);
router.get('/products/search', WebController.searchProducts);
router.get('/products/:id', WebController.getProductById);
// Get current user's orders
router.get('/orders/my', protect, OrderController.getUserOrders);
router.get('/orders/:orderId', protect, OrderController.getOrderDetails);
router.patch('/orders/:orderId/tracking', protect, OrderController.updateOrderTracking);
router.post('/orders/:orderId/reorder', protect, reorder);
router.get('/orders/:orderId/receipt', protect, OrderController.viewReceipt);

module.exports = router;
