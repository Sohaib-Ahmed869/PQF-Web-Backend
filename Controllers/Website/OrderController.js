const SalesOrder = require('../../Models/SalesOrder');
const User = require('../../Models/User');
const Cart = require('../../Models/Cart'); // Add this at the top
const Payment = require('../../Models/Payment'); // Import Payment model

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
    price: order.DocTotal,
    orderDate: order.createdAt,
    paymentType: order.paymentMethod,
    trackingNumber: order.trackingNumber,
    trackingStatus: order.trackingStatus,
    trackingHistory: order.trackingHistory
  };
  if (order.shippingAddress) flattened.shippingAddress = order.shippingAddress;
  if (order.billingAddress) flattened.billingAddress = order.billingAddress;
  return flattened;
}

// Utility to flatten order with payment details
async function flattenOrderWithPaymentIntent(order) {
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
  // Find payment for this order
  let payment = await Payment.findOne({ order: order._id }).lean();
  let paymentInfo = null;
  if (payment) {
    // Exclude __v and possibly _id if not needed
    const { __v, ...rest } = payment;
    paymentInfo = rest;
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
    price: order.DocTotal,
    orderDate: order.createdAt,
    paymentType: order.paymentMethod,
    trackingNumber: order.trackingNumber,
    trackingStatus: order.trackingStatus,
    trackingHistory: order.trackingHistory,
    payment: paymentInfo // Add all payment fields here
  };
  if (order.shippingAddress) flattened.shippingAddress = order.shippingAddress;
  if (order.billingAddress) flattened.billingAddress = order.billingAddress;
  return flattened;
}


const getOrderDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId } = req.params;
    const order = await SalesOrder.findOne({ _id: orderId, user: userId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const flattened = flattenOrder(order);
    return res.status(200).json({ success: true, data: flattened });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

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

// Updated reorder function for backend
const reorder = async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId } = req.params;
    const order = await SalesOrder.findOne({ _id: orderId, user: userId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Find the user's active cart, or create a new one if none exists or if the existing cart is not active
    let cart = await Cart.findOne({ user: userId, status: 'active' });
    if (!cart) {
      cart = new Cart({ user: userId, items: [], status: 'active' });
    }

    // Add each order item to the cart
    const addedItems = [];
    for (const orderItem of order.orderItems) {
      // Check if item already exists in cart
      const existingItemIndex = cart.items.findIndex(
        item => item.product.toString() === orderItem.product.toString()
      );

      if (existingItemIndex > -1) {
        // Item exists, increase quantity
        cart.items[existingItemIndex].quantity += orderItem.quantity;
      } else {
        // Add new item to cart
        cart.items.push({
          product: orderItem.product,
          quantity: orderItem.quantity,
          price: orderItem.price,
          addedAt: new Date()
        });
      }

      addedItems.push({
        _id: orderItem._id,
        product: orderItem.product,
        name: orderItem.name,
        quantity: orderItem.quantity,
        price: orderItem.price,
        image: orderItem.image
      });
    }

    await cart.save();
    // Populate the cart with product details before sending response
    await cart.populate('items.product');
    return res.status(200).json({ 
      success: true, 
      message: 'Items added to cart successfully',
      data: {
        items: addedItems,
        cart: cart
      }
    });
  } catch (error) {
    console.error('Reorder error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Download receipt for an order
const viewReceipt = async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId } = req.params;
    const order = await SalesOrder.findOne({ _id: orderId, user: userId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    // Return the flattened order with paymentIntentId for receipt rendering
    const flattened = await flattenOrderWithPaymentIntent(order);
    return res.status(200).json({ success: true, data: flattened });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getUserOrders,
  updateOrderTracking,
  getOrderDetails,
  reorder,
  viewReceipt,
};
