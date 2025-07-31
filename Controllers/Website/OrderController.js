const SalesOrder = require('../../Models/SalesOrder');
const User = require('../../Models/User');
const Cart = require('../../Models/Cart'); // Add this at the top
const Payment = require('../../Models/Payment'); // Import Payment model
const Dispute = require('../../Models/Dispute'); // Import Dispute model
const mongoose = require('mongoose');

// Get all orders for the currently authenticated user
const getUserOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const orders = await SalesOrder.find({ user: userId })
      .populate('user', 'email')
      .populate('parentRecurringOrder', 'DocNum DocTotal createdAt recurringFrequency recurringStatus')
      .sort({ createdAt: -1 });
    
    // Get dispute information for all orders
    const orderIds = orders.map(order => order._id);
    const disputes = await Dispute.find({ 
      order: { $in: orderIds },
      user: userId 
    }).select('order disputeStatus disputeCategory createdAt');
    
    // Create a map of orderId to dispute info
    const disputeMap = {};
    disputes.forEach(dispute => {
      disputeMap[dispute.order.toString()] = {
        status: dispute.disputeStatus,
        category: dispute.disputeCategory,
        createdAt: dispute.createdAt
      };
    });
    
    const flattened = orders.map(order => {
      const orderObj = flattenOrder(order);
      // Add dispute information if it exists
      if (disputeMap[order._id.toString()]) {
        orderObj.dispute = disputeMap[order._id.toString()];
      } else {
        orderObj.dispute = { status: 'none' };
      }
      return orderObj;
    });
    
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
  
  // Prepare recurring order information
  let recurringInfo = null;
  if (order.isRecurring) {
    recurringInfo = {
      isRecurring: true,
      frequency: order.recurringFrequency,
      interval: order.recurringInterval,
      status: order.recurringStatus,
      nextOrderDate: order.nextRecurringDate,
      endDate: order.recurringEndDate,
      totalCycles: order.totalRecurringCycles,
      completedCycles: order.completedRecurringCycles,
      stripeSubscriptionId: order.stripeSubscriptionId
    };
  } else if (order.generatedFromRecurring && order.parentRecurringOrder) {
    recurringInfo = {
      isRecurring: false,
      generatedFromRecurring: true,
      parentRecurringOrder: {
        orderId: order.parentRecurringOrder._id,
        orderNumber: order.parentRecurringOrder.DocNum,
        frequency: order.parentRecurringOrder.recurringFrequency,
        status: order.parentRecurringOrder.recurringStatus,
        createdAt: order.parentRecurringOrder.createdAt
      }
    };
  }
  
  const flattened = {
    orderId: order._id,
    orderItems: order.orderItems,
    cardCode: order.CardCode,
    cardName: order.CardName,
    email: order.user?.email || '', // Get email from populated user
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
    dispute: order.dispute || { status: 'none' },
    recurring: recurringInfo
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

  // Prepare recurring order information
  let recurringInfo = null;
  if (order.isRecurring) {
    recurringInfo = {
      isRecurring: true,
      frequency: order.recurringFrequency,
      interval: order.recurringInterval,
      status: order.recurringStatus,
      nextOrderDate: order.nextRecurringDate,
      endDate: order.recurringEndDate,
      totalCycles: order.totalRecurringCycles,
      completedCycles: order.completedRecurringCycles,
      stripeSubscriptionId: order.stripeSubscriptionId
    };
  } else if (order.generatedFromRecurring && order.parentRecurringOrder) {
    recurringInfo = {
      isRecurring: false,
      generatedFromRecurring: true,
      parentRecurringOrder: {
        orderId: order.parentRecurringOrder._id,
        orderNumber: order.parentRecurringOrder.DocNum,
        frequency: order.parentRecurringOrder.recurringFrequency,
        status: order.parentRecurringOrder.recurringStatus,
        createdAt: order.parentRecurringOrder.createdAt
      }
    };
  }

  const flattened = {
    orderId: order._id,
    orderItems: order.orderItems,
    cardCode: order.CardCode,
    cardName: order.CardName,
    email: order.email,
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
    payment: paymentInfo, // Add all payment fields here
    dispute: order.dispute || { status: 'none' },
    return: order.return || { status: 'none' },
    recurring: recurringInfo
  };
  if (order.shippingAddress) flattened.shippingAddress = order.shippingAddress;
  if (order.billingAddress) flattened.billingAddress = order.billingAddress;
  return flattened;
}


const getOrderDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId } = req.params;
    const order = await SalesOrder.findOne({ _id: orderId, user: userId })
      .populate('parentRecurringOrder', 'DocNum DocTotal createdAt recurringFrequency recurringStatus');
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
    const order = await SalesOrder.findOne({ _id: orderId, user: userId })
      .populate('parentRecurringOrder', 'DocNum DocTotal createdAt recurringFrequency recurringStatus');
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

// Get tracking data for a specific order
const getOrderTracking = async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId } = req.params;
    let order = null;
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      order = await SalesOrder.findOne({ _id: orderId, user: userId });
    }
    if (!order) {
      order = await SalesOrder.findOne({ trackingNumber: orderId, user: userId });
    }
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    // Only return tracking-related fields
    return res.status(200).json({
      success: true,
      data: {
        orderId: order._id,
        trackingNumber: order.trackingNumber,
        trackingStatus: order.trackingStatus,
        trackingHistory: order.trackingHistory
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get customer's recurring orders
const getCustomerRecurringOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status } = req.query;

    let filter = { user: userId, isRecurring: true };
    
    if (status && status !== 'all') {
      filter.recurringStatus = status;
    }

    const recurringOrders = await SalesOrder.find(filter)
      .populate('user', 'email')
      .populate('parentRecurringOrder', 'DocNum DocTotal createdAt recurringFrequency recurringStatus')
      .sort({ createdAt: -1 });

    // Get generated orders for each recurring order
    const recurringOrderIds = recurringOrders.map(order => order._id);
    const generatedOrders = await SalesOrder.find({ 
      user: userId, 
      parentRecurringOrder: { $in: recurringOrderIds },
      generatedFromRecurring: true 
    })
    .populate('user', 'email')
    .populate('parentRecurringOrder', 'DocNum DocTotal createdAt recurringFrequency recurringStatus')
    .sort({ createdAt: -1 });

    // Group generated orders by parent recurring order
    const generatedOrdersMap = {};
    generatedOrders.forEach(order => {
      const parentId = order.parentRecurringOrder.toString();
      if (!generatedOrdersMap[parentId]) {
        generatedOrdersMap[parentId] = [];
      }
      generatedOrdersMap[parentId].push(order);
    });

    // Flatten recurring orders with the same structure as regular orders
    const flattenedRecurringOrders = recurringOrders.map(order => {
      const orderObj = flattenOrder(order);
      orderObj.generatedOrders = (generatedOrdersMap[order._id.toString()] || []).map(generatedOrder => {
        return flattenOrder(generatedOrder);
      });
      return orderObj;
    });

    return res.status(200).json({
      success: true,
      count: flattenedRecurringOrders.length,
      data: flattenedRecurringOrders
    });
  } catch (error) {
    console.error('Get customer recurring orders error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getUserOrders,
  getOrderDetails,
  updateOrderTracking,
  getOrderDetails,
  reorder,
  viewReceipt,
  getOrderTracking,
  getCustomerRecurringOrders,
};
