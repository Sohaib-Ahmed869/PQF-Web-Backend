const SalesOrder = require('../../Models/SalesOrder');
const PQFPayment = require('../../Models/Payment');
const { sendOrderStatusUpdateEmail } = require('../../Services/emailService');

const getAllOrdersAdmin = async (req, res) => {
  try {
    console.log('getAllOrdersAdmin called with query:', req.query);
    const { storeId, sortBy = 'createdAt', sortOrder = 'desc', search = '' } = req.query;
    const user = req.user;
    const isSuperAdmin = user.role === 'superAdmin';
    console.log('User:', user.email, 'Role:', user.role, 'IsSuperAdmin:', isSuperAdmin);
    let filter = {};

    // Admins can only see their assigned store
    if (!isSuperAdmin) {
      if (!user.assignedStore) {
        return res.status(403).json({ success: false, message: 'Admin must have an assigned store.' });
      }
      filter.store = user.assignedStore._id || user.assignedStore;
    } else if (storeId) {
      filter.store = storeId;
    }

    // Optional search (by CardName, CardCode, DocNum, user name, etc.)
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { CardName: searchRegex },
        { CardCode: searchRegex },
        { DocNum: isNaN(Number(search)) ? undefined : Number(search) },
      ].filter(Boolean);
    }

    // Sorting only (no pagination)
    const sortOptions = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    // Query all matching orders
    const orders = await SalesOrder.find(filter)
      .populate('user', 'name email phone')
      .populate('store', 'name location status')
      .populate('payment')
      .sort(sortOptions)
      .lean();

    // Optionally, flatten/shape orders for admin
    const shapedOrders = await Promise.all(orders.map(async (order) => {
      // Find payment if not already populated (for legacy data)
      let payment = order.payment;
      if (!payment && order._id) {
        payment = await PQFPayment.findOne({ order: order._id }).lean();
      }
      return {
        orderId: order._id,
        docNum: order.DocNum,
        docEntry: order.DocEntry,
        cardCode: order.CardCode,
        cardName: order.CardName,
        orderType: order.orderType,
        notes: order.notes,
        orderItems: order.orderItems,
        price: order.DocTotal,
        paymentStatus: order.payment_status,
        paymentType: order.paymentMethod,
        payment: payment || null,
        user: order.user || null,
        store: order.store || null,
        shippingAddress: order.shippingAddress,
        billingAddress: order.billingAddress,
        trackingNumber: order.trackingNumber,
        trackingStatus: order.trackingStatus,
        trackingHistory: order.trackingHistory,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        status: order.DocumentStatus,
      };
    }));

    return res.status(200).json({
      success: true,
      count: shapedOrders.length,
      data: shapedOrders
    });
  } catch (error) {
    console.error('Admin order listing error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /admin/orders/:orderId
 * Only admin/superAdmin can access. Admins see only their store's orders; superAdmin can see all.
 */
const getOrderDetailsAdmin = async (req, res) => {
  try {
    const { orderId } = req.params;
    const user = req.user;
    const isSuperAdmin = user.role === 'superAdmin';

    // Find the order and populate related fields
    const order = await SalesOrder.findById(orderId)
      .populate('user', 'name email phone')
      .populate('store', 'name location status')
      .populate('payment')
      .lean();

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Admins can only see their assigned store's orders
    if (!isSuperAdmin) {
      if (!user.assignedStore || String(order.store?._id || order.store) !== String(user.assignedStore._id || user.assignedStore)) {
        return res.status(403).json({ success: false, message: 'Access denied: not your store order.' });
      }
    }

    // Find payment if not already populated (for legacy data)
    let payment = order.payment;
    if (!payment && order._id) {
      payment = await PQFPayment.findOne({ order: order._id }).lean();
    }

    const shapedOrder = {
      orderId: order._id,
      docNum: order.DocNum,
      docEntry: order.DocEntry,
      cardCode: order.CardCode,
      cardName: order.CardName,
      orderType: order.orderType,
      notes: order.notes,
      orderItems: order.orderItems,
      price: order.DocTotal,
      paymentStatus: order.payment_status,
      paymentType: order.paymentMethod,
      payment: payment || null,
      user: order.user || null,
      store: order.store || null,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      trackingNumber: order.trackingNumber,
      trackingStatus: order.trackingStatus,
      trackingHistory: order.trackingHistory,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      status: order.DocumentStatus,
    };

    return res.status(200).json({
      success: true,
      data: shapedOrder
    });
  } catch (error) {
    console.error('Admin order details error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /admin/orders/:orderId/tracking
 * Allows admin/superAdmin to update tracking info for an order.
 * Only admin of the store or superAdmin can update.
 * Body: { trackingNumber, trackingStatus, trackingNote }
 */
const updateOrderTrackingAdmin = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { trackingNumber, trackingStatus, trackingNote } = req.body;
    const user = req.user;
    const isSuperAdmin = user.role === 'superAdmin';

    // Find the order and populate related fields
    const order = await SalesOrder.findById(orderId)
      .populate('user', 'name email phone')
      .populate('store', 'name location status')
      .populate('payment');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Admins can only update their assigned store's orders
    if (!isSuperAdmin) {
      if (!user.assignedStore || String(order.store?._id || order.store) !== String(user.assignedStore._id || user.assignedStore)) {
        return res.status(403).json({ success: false, message: 'Access denied: not your store order.' });
      }
    }

    // Store previous status for email notification
    const previousStatus = order.trackingStatus;
    
    // Update tracking fields if provided
    if (trackingNumber !== undefined) order.trackingNumber = trackingNumber;
    if (trackingStatus !== undefined) order.trackingStatus = trackingStatus;
    // Add to tracking history
    if (trackingStatus) {
      order.trackingHistory = order.trackingHistory || [];
      order.trackingHistory.push({
        status: trackingStatus,
        timestamp: new Date(),
        note: trackingNote || ''
      });
    }
    await order.save();

    // Send status update email if status changed and user has email
    if (trackingStatus && trackingStatus !== previousStatus && order.user?.email) {
      try {
        const emailData = {
          orderId: order._id,
          orderType: order.orderType,
          paymentStatus: order.payment_status,
          trackingNumber: order.trackingNumber,
          totalPrice: order.DocTotal || 0,
          orderItems: order.orderItems
        };
        
        await sendOrderStatusUpdateEmail(
          order.user.email,
          emailData,
          order.user.name || order.CardName,
          trackingStatus,
          previousStatus
        );
        console.log('Status update email sent successfully');
      } catch (emailError) {
        console.error('Error sending status update email:', emailError);
        // Don't fail the status update if email fails
      }
    }

    // Re-populate for response
    const updatedOrder = await SalesOrder.findById(orderId)
      .populate('user', 'name email phone')
      .populate('store', 'name location status')
      .populate('payment')
      .lean();

    // Find payment if not already populated (for legacy data)
    let payment = updatedOrder.payment;
    if (!payment && updatedOrder._id) {
      payment = await PQFPayment.findOne({ order: updatedOrder._id }).lean();
    }

    const shapedOrder = {
      orderId: updatedOrder._id,
      docNum: updatedOrder.DocNum,
      docEntry: updatedOrder.DocEntry,
      cardCode: updatedOrder.CardCode,
      cardName: updatedOrder.CardName,
      orderType: updatedOrder.orderType,
      notes: updatedOrder.notes,
      orderItems: updatedOrder.orderItems,
      price: updatedOrder.DocTotal,
      paymentStatus: updatedOrder.payment_status,
      paymentType: updatedOrder.paymentMethod,
      payment: payment || null,
      user: updatedOrder.user || null,
      store: updatedOrder.store || null,
      shippingAddress: updatedOrder.shippingAddress,
      billingAddress: updatedOrder.billingAddress,
      trackingNumber: updatedOrder.trackingNumber,
      trackingStatus: updatedOrder.trackingStatus,
      trackingHistory: updatedOrder.trackingHistory,
      createdAt: updatedOrder.createdAt,
      updatedAt: updatedOrder.updatedAt,
      status: updatedOrder.DocumentStatus,
    };

    return res.status(200).json({
      success: true,
      message: 'Order tracking updated',
      data: shapedOrder
    });
  } catch (error) {
    console.error('Admin update order tracking error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /orders/stats
 * Get order statistics for dashboard
 */
const getOrderStatsAdmin = async (req, res) => {
  try {
    const user = req.user;
    const isSuperAdmin = user.role === 'superAdmin';
    let filter = {};

    // Admins can only see their assigned store
    if (!isSuperAdmin) {
      if (!user.assignedStore) {
        return res.status(403).json({ success: false, message: 'Admin must have an assigned store.' });
      }
      filter.store = user.assignedStore._id || user.assignedStore;
    }

    // Get basic stats
    const totalOrders = await SalesOrder.countDocuments(filter);
    const pendingOrders = await SalesOrder.countDocuments({ ...filter, trackingStatus: 'pending' });
    const shippedOrders = await SalesOrder.countDocuments({ ...filter, trackingStatus: 'shipped' });
    const deliveredOrders = await SalesOrder.countDocuments({ ...filter, trackingStatus: 'delivered' });

    // Get revenue stats
    const revenueStats = await SalesOrder.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$DocTotal' },
          avgOrderValue: { $avg: '$DocTotal' }
        }
      }
    ]);

    const stats = {
      total: totalOrders,
      pending: pendingOrders,
      shipped: shippedOrders,
      delivered: deliveredOrders,
      totalRevenue: revenueStats[0]?.totalRevenue || 0,
      avgOrderValue: revenueStats[0]?.avgOrderValue || 0
    };

    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Admin order stats error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /orders/export
 * Export orders data
 */
const exportOrdersAdmin = async (req, res) => {
  try {
    const { format = 'csv' } = req.query;
    const user = req.user;
    const isSuperAdmin = user.role === 'superAdmin';
    let filter = {};

    // Admins can only see their assigned store
    if (!isSuperAdmin) {
      if (!user.assignedStore) {
        return res.status(403).json({ success: false, message: 'Admin must have an assigned store.' });
      }
      filter.store = user.assignedStore._id || user.assignedStore;
    }

    const orders = await SalesOrder.find(filter)
      .populate('user', 'name email phone')
      .populate('store', 'name location status')
      .populate('payment')
      .lean();

    // For now, return JSON. You can implement CSV/Excel export later
    if (format === 'json') {
      return res.status(200).json({
        success: true,
        data: orders
      });
    }

    // Simple CSV export
    const csvData = orders.map(order => ({
      orderId: order._id,
      customerName: order.CardName,
      email: order.user?.email || '',
      phone: order.user?.phone || '',
      orderType: order.orderType,
      status: order.trackingStatus,
      total: order.DocTotal,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    }));

    const csv = [
      'Order ID,Customer Name,Email,Phone,Order Type,Status,Total,Created At,Updated At',
      ...csvData.map(row => 
        `${row.orderId},"${row.customerName}","${row.email}","${row.phone}","${row.orderType}","${row.status}",${row.total},"${row.createdAt}","${row.updatedAt}"`
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=orders-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);

  } catch (error) {
    console.error('Admin export orders error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /orders/bulk-status
 * Bulk update order statuses
 */
const bulkUpdateOrderStatusAdmin = async (req, res) => {
  try {
    const { orderIds, status, note } = req.body;
    const user = req.user;
    const isSuperAdmin = user.role === 'superAdmin';

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Order IDs array is required' });
    }

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    let filter = { _id: { $in: orderIds } };

    // Admins can only update their assigned store's orders
    if (!isSuperAdmin) {
      if (!user.assignedStore) {
        return res.status(403).json({ success: false, message: 'Admin must have an assigned store.' });
      }
      filter.store = user.assignedStore._id || user.assignedStore;
    }

    const orders = await SalesOrder.find(filter);
    
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'No orders found to update' });
    }

    // Update all orders and send emails
    const updatePromises = orders.map(async order => {
      const previousStatus = order.trackingStatus;
      order.trackingStatus = status;
      if (order.trackingHistory) {
        order.trackingHistory.push({
          status: status,
          timestamp: new Date(),
          note: note || `Bulk status update to ${status}`
        });
      }
      await order.save();

      // Send status update email if status changed and user has email
      if (status !== previousStatus && order.user?.email) {
        try {
          const emailData = {
            orderId: order._id,
            orderType: order.orderType,
            paymentStatus: order.payment_status,
            trackingNumber: order.trackingNumber,
            totalPrice: order.DocTotal || 0,
            orderItems: order.orderItems
          };
          
          await sendOrderStatusUpdateEmail(
            order.user.email,
            emailData,
            order.user.name || order.CardName,
            status,
            previousStatus
          );
        } catch (emailError) {
          console.error('Error sending status update email:', emailError);
          // Don't fail the bulk update if email fails
        }
      }
    });

    await Promise.all(updatePromises);

    return res.status(200).json({
      success: true,
      message: `Updated ${orders.length} orders to ${status}`,
      updatedCount: orders.length
    });

  } catch (error) {
    console.error('Admin bulk update order status error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /orders/:orderId/notify
 * Send notification to customer
 */
const sendOrderNotificationAdmin = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { type, message } = req.body;
    const user = req.user;
    const isSuperAdmin = user.role === 'superAdmin';

    const order = await SalesOrder.findById(orderId)
      .populate('user', 'name email phone')
      .populate('store', 'name location status');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Admins can only notify for their assigned store's orders
    if (!isSuperAdmin) {
      if (!user.assignedStore || String(order.store?._id || order.store) !== String(user.assignedStore._id || user.assignedStore)) {
        return res.status(403).json({ success: false, message: 'Access denied: not your store order.' });
      }
    }

    // For now, just log the notification. You can implement actual notification sending later
    console.log('Order notification:', {
      orderId,
      type,
      message,
      customer: order.user?.email || order.CardName,
      sentBy: user.email
    });

    return res.status(200).json({
      success: true,
      message: 'Notification sent successfully',
      data: {
        orderId,
        type,
        message,
        sentAt: new Date()
      }
    });

  } catch (error) {
    console.error('Admin send order notification error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /orders/:orderId/timeline
 * Get order timeline/history
 */
const getOrderTimelineAdmin = async (req, res) => {
  try {
    const { orderId } = req.params;
    const user = req.user;
    const isSuperAdmin = user.role === 'superAdmin';

    const order = await SalesOrder.findById(orderId)
      .populate('user', 'name email phone')
      .populate('store', 'name location status');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Admins can only see their assigned store's orders
    if (!isSuperAdmin) {
      if (!user.assignedStore || String(order.store?._id || order.store) !== String(user.assignedStore._id || user.assignedStore)) {
        return res.status(403).json({ success: false, message: 'Access denied: not your store order.' });
      }
    }

    const timeline = order.trackingHistory || [];

    return res.status(200).json({
      success: true,
      data: timeline
    });

  } catch (error) {
    console.error('Admin get order timeline error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};




module.exports = {
  getAllOrdersAdmin,
  getOrderDetailsAdmin,
  updateOrderTrackingAdmin,
  getOrderStatsAdmin,
  exportOrdersAdmin,
  bulkUpdateOrderStatusAdmin,
  sendOrderNotificationAdmin,
  getOrderTimelineAdmin,
}; 