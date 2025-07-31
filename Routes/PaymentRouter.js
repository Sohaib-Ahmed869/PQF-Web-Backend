const express = require('express');
const router = express.Router();
const paymentController = require('../Controllers/PaymentController');
const { protect } = require('../Middleware/Authentication');

// Webhook route - uses raw body from index.js middleware
router.post('/webhook', paymentController.handleStripeWebhook);

// All other routes use JSON body parsing
router.post('/create-payment-intent', protect, paymentController.createPaymentIntent);
router.post('/create-order', protect, paymentController.createOrderAfterPayment);

// Subscription routes
router.post('/subscriptions/create', protect, paymentController.createSubscription);
router.post('/subscriptions/cancel', protect, paymentController.cancelSubscription);
router.post('/subscriptions/pause', protect, paymentController.pauseSubscription);
router.post('/subscriptions/resume', protect, paymentController.resumeSubscription);
router.post('/subscriptions/activate', protect, paymentController.activateSubscription);
router.get('/subscriptions', protect, paymentController.getUserSubscriptions);

// Additional useful routes you might want to add:

// Get specific subscription details
router.get('/subscriptions/:subscriptionId', protect, async (req, res) => {
  try { 
    const { subscriptionId } = req.params;
    
    // Find the subscription order
    const SalesOrder = require('../Models/SalesOrder');
    const subscription = await SalesOrder.findOne({
      _id: subscriptionId,
      user: req.user._id,
      isRecurring: true
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    res.json({
      success: true,
      subscription: {
        id: subscription._id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        status: subscription.recurringStatus,
        frequency: subscription.recurringFrequency,
        interval: subscription.recurringInterval,
        nextRecurringDate: subscription.nextRecurringDate,
        totalCycles: subscription.totalRecurringCycles,
        completedCycles: subscription.completedRecurringCycles,
        endDate: subscription.recurringEndDate,
        orderItems: subscription.orderItems,
        totalPrice: subscription.DocTotal,
        createdAt: subscription.createdAt,
        trackingHistory: subscription.trackingHistory
      }
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch subscription'
    });
  }
});

// Get orders generated from a specific recurring subscription
router.get('/subscriptions/:subscriptionId/orders', protect, async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    const SalesOrder = require('../Models/SalesOrder');
    
    // Verify the subscription belongs to the user
    const subscription = await SalesOrder.findOne({
      _id: subscriptionId,
      user: req.user._id,
      isRecurring: true
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    // Get generated orders
    const orders = await SalesOrder.find({
      parentRecurringOrder: subscriptionId,
      generatedFromRecurring: true
    })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .select('_id DocEntry trackingNumber payment_status LocalStatus DocTotal orderItems createdAt');

    const totalOrders = await SalesOrder.countDocuments({
      parentRecurringOrder: subscriptionId,
      generatedFromRecurring: true
    });

    res.json({
      success: true,
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        hasNextPage: page < Math.ceil(totalOrders / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching subscription orders:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch subscription orders'
    });
  }
});

// Update subscription (change payment method, etc.)
router.put('/subscriptions/:subscriptionId', protect, async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const { stripePaymentMethodId } = req.body;

    if (!stripePaymentMethodId) {
      return res.status(400).json({
        success: false,
        message: 'Payment method ID is required'
      });
    }

    const SalesOrder = require('../Models/SalesOrder');
    const stripe = require('../Config/stripe');
    
    // Find the subscription order
    const order = await SalesOrder.findOne({
      _id: subscriptionId,
      user: req.user._id,
      isRecurring: true
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    if (!order.stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        message: 'No active Stripe subscription found'
      });
    }

    // Update the subscription in Stripe
    await stripe.subscriptions.update(order.stripeSubscriptionId, {
      default_payment_method: stripePaymentMethodId
    });

    // Update the order record
    order.stripePaymentMethodId = stripePaymentMethodId;
    order.updatedAt = new Date();
    
    // Add tracking history
    order.trackingHistory.push({
      status: 'payment_method_updated',
      timestamp: new Date(),
      note: 'Payment method updated'
    });

    await order.save();

    res.json({
      success: true,
      message: 'Payment method updated successfully'
    });

  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update subscription'
    });
  }
});

// Get payment history for user
router.get('/payments', protect, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const Payment = require('../Models/Payment');
    
    let query = { user: req.user._id };
    if (status) {
      query.status = status;
    }

    const payments = await Payment.find(query)
      .populate('order', '_id DocEntry trackingNumber orderType')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const totalPayments = await Payment.countDocuments(query);

    res.json({
      success: true,
      payments,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalPayments / limit),
        totalPayments,
        hasNextPage: page < Math.ceil(totalPayments / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch payments'
    });
  }
});

// Error handling middleware for payment routes
router.use((error, req, res, next) => {
  console.error('Payment route error:', error);
  
  if (error.type === 'StripeCardError') {
    return res.status(400).json({
      success: false,
      error: 'Card payment failed',
      details: error.message
    });
  }
  
  if (error.type === 'StripeInvalidRequestError') {
    return res.status(400).json({
      success: false,
      error: 'Invalid payment request',
      details: error.message
    });
  }
  
  if (error.type === 'StripeAuthenticationError') {
    return res.status(401).json({
      success: false,
      error: 'Payment authentication failed'
    });
  }
  
  if (error.type === 'StripeConnectionError') {
    return res.status(503).json({
      success: false,
      error: 'Payment service temporarily unavailable'
    });
  }
  
  // Generic error
  res.status(500).json({
    success: false,
    error: 'Internal payment processing error'
  });
});

module.exports = router;