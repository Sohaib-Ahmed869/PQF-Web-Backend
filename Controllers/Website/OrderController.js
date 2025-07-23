const SalesOrder = require('../../Models/SalesOrder');
const User = require('../../Models/User');

// Get all orders for the currently authenticated user
const getUserOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const orders = await SalesOrder.find({ user: userId })
      .sort({ createdAt: -1 });
    const flattened = orders.map(flattenOrder);
    return res.status(200).json({ success: true, count: flattened.length, data: flattened });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Utility to flatten order for guest view
function flattenOrder(order) {
  let location = {};
  if (order.orderType === 'pickup' && order.pickupStore && order.pickupStore.location && order.pickupStore.location.address) {
    const addr = order.pickupStore.location.address;
    location = {
      type: 'pickup',
      address: [addr.street, addr.city, addr.country].filter(Boolean).join(', ')
    };
  } else if (order.orderType === 'delivery' && order.shippingAddress) {
    const addr = order.shippingAddress;
    location = {
      type: 'delivery',
      address: [addr.address, addr.city, addr.country].filter(Boolean).join(', ')
    };
  }
  const flattened = {
    orderId: order._id,
    orderItems: order.orderItems,
    cardCode: order.CardCode,
    cardName: order.CardName,
    orderType: order.orderType,
    notes: order.notes,
    location,
    paymentStatus: order.payment_status,
    price: order.DocTotal
  };
  if (order.shippingAddress) flattened.shippingAddress = order.shippingAddress;
  if (order.billingAddress) flattened.billingAddress = order.billingAddress;
  return flattened;
}

// Update order tracking info
const updateOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { trackingNumber, trackingStatus, trackingNote } = req.body;
    // Only allow admin or authorized user (add your own auth logic as needed)
    // Example: if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

    const order = await SalesOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
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
    return res.status(200).json({ success: true, message: 'Order tracking updated', order });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getUserOrders,
  updateOrderTracking,
};
