const express = require('express');
const router = express.Router();

const {
  getAllOrdersAdmin,
  getOrderDetailsAdmin,
  updateOrderTrackingAdmin,
  getOrderStatsAdmin,
  exportOrdersAdmin,
  bulkUpdateOrderStatusAdmin,
  sendOrderNotificationAdmin,
  getOrderTimelineAdmin,
} = require('../../Controllers/Admin/OrderController');

const {
  protect,
  requireAdmin
} = require('../../Middleware/Authentication');

// RESTful admin order routes
router.get('/', protect, requireAdmin, getAllOrdersAdmin);
router.get('/stats', protect, requireAdmin, getOrderStatsAdmin);
router.get('/export', protect, requireAdmin, exportOrdersAdmin);
router.patch('/bulk-status', protect, requireAdmin, bulkUpdateOrderStatusAdmin);

// Order-specific routes
router.get('/:orderId', protect, requireAdmin, getOrderDetailsAdmin);
router.get('/:orderId/timeline', protect, requireAdmin, getOrderTimelineAdmin);
router.patch('/:orderId/tracking', protect, requireAdmin, updateOrderTrackingAdmin);
router.post('/:orderId/notify', protect, requireAdmin, sendOrderNotificationAdmin);


module.exports = router; 