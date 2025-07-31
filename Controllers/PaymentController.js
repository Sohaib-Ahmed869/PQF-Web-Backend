const stripe = require('../Config/stripe');
const SalesOrder = require('../Models/SalesOrder');
const Payment = require('../Models/Payment');
const Cart = require('../Models/Cart');
const User = require('../Models/User');
const { sendOrderConfirmationEmail } = require('../Services/emailService');

// Function to generate tracking number
const generateTrackingNumber = () => {
  const prefix = 'PQF'; // Premium Quality Foods
  const timestamp = Date.now().toString().slice(-8); // Last 8 digits of timestamp
  const random = Math.random().toString(36).substring(2, 6).toUpperCase(); // 4 random characters
  return `${prefix}${timestamp}${random}`;
};

// Stripe Webhook Handler
exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('Webhook received:', event.type);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;
      
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object);
        break;
      
      case 'payment_intent.canceled':
        await handlePaymentIntentCanceled(event.data.object);
        break;
      
      case 'charge.succeeded':
        await handleChargeSucceeded(event.data.object);
        break;
      
      case 'charge.failed':
        await handleChargeFailed(event.data.object);
        break;
      
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object);
        break;
      
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;
      
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;
      
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
      
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      
      case 'customer.subscription.paused':
        await handleSubscriptionPaused(event.data.object);
        break;
      
      case 'customer.subscription.resumed':
        await handleSubscriptionResumed(event.data.object);
        break;
      
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    // Return 200 to prevent Stripe from retrying
    res.status(200).json({ error: 'Webhook processing failed', message: error.message });
  }
};

// Helper function to create a new order from recurring parent
async function createRecurringOrder(parentOrder, invoice = null) {
  try {
    console.log('Creating new recurring order from parent:', parentOrder._id);

    // Generate new tracking number
    const trackingNumber = generateTrackingNumber();

    // Create new order with same details as parent
    const newOrder = new SalesOrder({
      DocEntry: Date.now(), // Temporary ID until SAP sync
      CardName: parentOrder.CardName,
      CardCode: parentOrder.CardCode,
      payment_status: invoice ? 'paid' : 'pending',
      Payment_id: invoice ? invoice.payment_intent : null,
      SyncedWithSAP: false,
      LocalStatus: 'Created',
      DocumentLines: parentOrder.DocumentLines,
      Address: parentOrder.Address,
      Address2: parentOrder.Address2,
      Comments: parentOrder.Comments,
      DocTotal: parentOrder.DocTotal,
      orderItems: parentOrder.orderItems,
      shippingAddress: parentOrder.shippingAddress,
      billingAddress: parentOrder.billingAddress,
      notes: parentOrder.notes,
      orderType: parentOrder.orderType,
      pickupStore: parentOrder.pickupStore,
      store: parentOrder.store,
      user: parentOrder.user,
      trackingNumber: trackingNumber,
      trackingStatus: 'pending',
      trackingHistory: [
        {
          status: 'pending',
          timestamp: new Date(),
          note: `Recurring order created from subscription ${parentOrder.stripeSubscriptionId}`
        }
      ],
      paymentMethod: parentOrder.paymentMethod,
      
      // Recurring order specific fields
      isRecurring: false, // This is a generated order, not the recurring template
      generatedFromRecurring: true,
      parentRecurringOrder: parentOrder._id,
      
      // Clear recurring-specific fields for generated orders
      recurringFrequency: null,
      recurringInterval: null,
      nextRecurringDate: null,
      recurringEndDate: null,
      totalRecurringCycles: null,
      completedRecurringCycles: null,
      recurringStatus: null,
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      
      createdAt: new Date(),
    });

    await newOrder.save();
    console.log('New recurring order created:', newOrder._id, 'Tracking:', trackingNumber);

    // Create payment record for the new order
    if (invoice) {
      const paymentRecord = new Payment({
        order: newOrder._id,
        user: parentOrder.user,
        customer: parentOrder.user, // Use userId as customer reference
        paymentIntentId: invoice.payment_intent,
        amount: invoice.amount_paid / 100, // Convert from cents
        currency: invoice.currency,
        status: 'succeeded',
        paymentMethod: 'card',
        store: parentOrder.store,
        createdAt: new Date(),
      });

      await paymentRecord.save();
      
      // Link payment to order
      newOrder.payment = paymentRecord._id;
      await newOrder.save();
      
      console.log('Payment record created for recurring order:', paymentRecord._id);
    }

    // Send order confirmation email
    try {
      const user = await User.findById(parentOrder.user);
      if (user && user.email) {
        const emailData = {
          orderId: newOrder._id,
          orderType: newOrder.orderType,
          paymentMethod: newOrder.paymentMethod,
          paymentStatus: newOrder.payment_status,
          trackingNumber: trackingNumber,
          totalPrice: newOrder.DocTotal,
          orderItems: newOrder.orderItems,
          shippingAddress: newOrder.shippingAddress,
          billingAddress: newOrder.billingAddress,
          isRecurring: false, // This is a generated order
          fromRecurring: true // Flag to indicate this came from a recurring order
        };
        
        await sendOrderConfirmationEmail(
          user.email,
          emailData,
          user.name || parentOrder.CardName
        );
        console.log('Recurring order confirmation email sent successfully');
      }
    } catch (emailError) {
      console.error('Error sending recurring order confirmation email:', emailError);
      // Don't fail the order creation if email fails
    }

    return newOrder;
  } catch (error) {
    console.error('Error creating recurring order:', error);
    throw error;
  }
}

// Webhook Event Handlers
async function handlePaymentIntentSucceeded(paymentIntent) {
  console.log('Processing payment_intent.succeeded:', paymentIntent.id);
  
  try {
    // Find the payment record by payment intent ID or order
    let payment = await Payment.findOne({ paymentIntentId: paymentIntent.id });
    
    if (!payment) {
      // Try to find payment by order that has this payment intent
      const order = await SalesOrder.findOne({ Payment_id: paymentIntent.id });
      if (order) {
        payment = await Payment.findOne({ order: order._id });
      }
    }
    
    if (!payment) {
      console.log('Payment record not found for payment intent:', paymentIntent.id);
      // Try to find order by payment intent ID in metadata or other fields
      const order = await SalesOrder.findOne({ Payment_id: paymentIntent.id });
      if (order) {
        order.payment_status = 'paid';
        order.LocalStatus = 'Confirmed';
        
        // Add tracking history entry
        order.trackingHistory.push({
          status: 'payment_confirmed',
          timestamp: new Date(),
          note: 'Payment confirmed via Stripe webhook (no payment record found)'
        });
        
        await order.save();
        console.log('Order updated after payment success (no payment record):', order._id);
      }
      return;
    }

    // Update payment status
    payment.status = 'paid';
    payment.updatedAt = new Date();
    await payment.save();

    // Find and update the order
    const order = await SalesOrder.findById(payment.order);
    if (order) {
      order.payment_status = 'paid';
      order.LocalStatus = 'Confirmed';
      // Update Payment_id field with Stripe Payment Intent ID or Subscription ID
      if (payment.paymentIntentId) {
        order.Payment_id = payment.paymentIntentId;
      } else if (payment.transactionDetails?.stripeSubscriptionId) {
        order.Payment_id = payment.transactionDetails.stripeSubscriptionId;
      } else {
        order.Payment_id = payment._id.toString();
      }
      
      // Add tracking history entry
      order.trackingHistory.push({
        status: 'payment_confirmed',
        timestamp: new Date(),
        note: 'Payment confirmed via Stripe webhook'
      });
      
      await order.save();
      console.log('Order updated after payment success:', order._id);
    }

    console.log('Payment intent succeeded processed successfully');
  } catch (error) {
    console.error('Error handling payment_intent.succeeded:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Payment intent succeeded error details:', {
      paymentIntentId: paymentIntent?.id,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handlePaymentIntentFailed(paymentIntent) {
  console.log('Processing payment_intent.payment_failed:', paymentIntent.id);
  
  try {
    // Find the payment record
    const payment = await Payment.findOne({ paymentIntentId: paymentIntent.id });
    if (!payment) {
      console.log('Payment record not found for payment intent:', paymentIntent.id);
      return;
    }

    // Update payment status
    payment.status = 'failed';
    payment.updatedAt = new Date();
    await payment.save();

    // Find and update the order
    const order = await SalesOrder.findById(payment.order);
    if (order) {
      order.payment_status = 'failed';
      order.LocalStatus = 'PaymentFailed';
      
      // Add tracking history entry
      order.trackingHistory.push({
        status: 'payment_failed',
        timestamp: new Date(),
        note: `Payment failed: ${paymentIntent.last_payment_error?.message || 'Unknown error'}`
      });
      
      await order.save();
      console.log('Order updated after payment failure:', order._id);
    }

    console.log('Payment intent failed processed successfully');
  } catch (error) {
    console.error('Error handling payment_intent.payment_failed:', error);
    throw error;
  }
}

async function handlePaymentIntentCanceled(paymentIntent) {
  console.log('Processing payment_intent.canceled:', paymentIntent.id);
  
  try {
    // Find the payment record
    const payment = await Payment.findOne({ paymentIntentId: paymentIntent.id });
    if (!payment) {
      console.log('Payment record not found for payment intent:', paymentIntent.id);
      return;
    }

    // Update payment status
    payment.status = 'canceled';
    payment.updatedAt = new Date();
    await payment.save();

    // Find and update the order
    const order = await SalesOrder.findById(payment.order);
    if (order) {
      order.payment_status = 'canceled';
      order.LocalStatus = 'Canceled';
      
      // Add tracking history entry
      order.trackingHistory.push({
        status: 'payment_canceled',
        timestamp: new Date(),
        note: 'Payment was canceled by customer or system'
      });
      
      await order.save();
      console.log('Order updated after payment cancellation:', order._id);
    }

    console.log('Payment intent canceled processed successfully');
  } catch (error) {
    console.error('Error handling payment_intent.canceled:', error);
    throw error;
  }
}

async function handleChargeSucceeded(charge) {
  console.log('Processing charge.succeeded:', charge.id);
  
  try {
    // Find payment by charge ID or payment intent ID
    const payment = await Payment.findOne({
      $or: [
        { paymentIntentId: charge.payment_intent },
        { chargeId: charge.id }
      ]
    });

    if (!payment) {
      console.log('Payment record not found for charge:', charge.id);
      return;
    }

    // Update payment with charge details
    payment.chargeId = charge.id;
    payment.receiptUrl = charge.receipt_url;
    payment.status = 'paid';
    payment.updatedAt = new Date();
    await payment.save();

    // Find and update the order
    const order = await SalesOrder.findById(payment.order);
    if (order) {
      order.payment_status = 'paid';
      order.LocalStatus = 'Confirmed';
      
      // Add tracking history entry
      order.trackingHistory.push({
        status: 'charge_succeeded',
        timestamp: new Date(),
        note: `Charge succeeded: ${charge.id}`
      });
      
      await order.save();
      console.log('Order updated after charge success:', order._id);
    }

    console.log('Charge succeeded processed successfully');
  } catch (error) {
    console.error('Error handling charge.succeeded:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Charge succeeded error details:', {
      chargeId: charge?.id,
      paymentIntentId: charge?.payment_intent,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleChargeFailed(charge) {
  console.log('Processing charge.failed:', charge.id);
  
  try {
    // Find payment by charge ID or payment intent ID
    const payment = await Payment.findOne({
      $or: [
        { paymentIntentId: charge.payment_intent },
        { chargeId: charge.id }
      ]
    });

    if (!payment) {
      console.log('Payment record not found for charge:', charge.id);
      return;
    }

    // Update payment status
    payment.status = 'failed';
    payment.updatedAt = new Date();
    await payment.save();

    // Find and update the order
    const order = await SalesOrder.findById(payment.order);
    if (order) {
      order.payment_status = 'failed';
      order.LocalStatus = 'PaymentFailed';
      
      // Add tracking history entry
      order.trackingHistory.push({
        status: 'charge_failed',
        timestamp: new Date(),
        note: `Charge failed: ${charge.failure_message || 'Unknown error'}`
      });
      
      await order.save();
      console.log('Order updated after charge failure:', order._id);
    }

    console.log('Charge failed processed successfully');
  } catch (error) {
    console.error('Error handling charge.failed:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Charge failed error details:', {
      chargeId: charge?.id,
      paymentIntentId: charge?.payment_intent,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleChargeRefunded(charge) {
  console.log('Processing charge.refunded:', charge.id);
  
  try {
    // Find payment by charge ID or payment intent ID
    const payment = await Payment.findOne({
      $or: [
        { paymentIntentId: charge.payment_intent },
        { chargeId: charge.id }
      ]
    });

    if (!payment) {
      console.log('Payment record not found for charge:', charge.id);
      return;
    }

    // Update payment status
    payment.status = 'refunded';
    payment.updatedAt = new Date();
    await payment.save();

    // Find and update the order
    const order = await SalesOrder.findById(payment.order);
    if (order) {
      order.payment_status = 'refunded';
      order.LocalStatus = 'Refunded';
      
      // Add tracking history entry
      order.trackingHistory.push({
        status: 'payment_refunded',
        timestamp: new Date(),
        note: `Payment refunded: ${charge.refunds?.data?.[0]?.id || 'Unknown refund'}`
      });
      
      await order.save();
      console.log('Order updated after charge refund:', order._id);
    }

    console.log('Charge refunded processed successfully');
  } catch (error) {
    console.error('Error handling charge.refunded:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Charge refunded error details:', {
      chargeId: charge?.id,
      paymentIntentId: charge?.payment_intent,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleSubscriptionCreated(subscription) {
  console.log('Processing customer.subscription.created:', subscription.id);
  
  try {
    // Find the order associated with this subscription using metadata
    let order = await SalesOrder.findOne({ stripeSubscriptionId: subscription.id });
    
    if (!order && subscription.metadata && subscription.metadata.orderId) {
      // If not found by subscription ID, try by order ID from metadata
      order = await SalesOrder.findById(subscription.metadata.orderId);
    }

    if (!order) {
      console.log('Order not found for subscription:', subscription.id);
      return;
    }

    // Update order with subscription details
    order.stripeSubscriptionId = subscription.id;
    order.recurringStatus = subscription.status === 'active' ? 'active' : 'paused';
    order.nextRecurringDate = new Date(subscription.current_period_end * 1000);
    order.isRecurring = true;
    order.updatedAt = new Date();
    
    // Add tracking history
    order.trackingHistory.push({
      status: 'subscription_created',
      timestamp: new Date(),
      note: `Subscription created: ${subscription.id}`
    });
    
    await order.save();

    console.log('Subscription created successfully for order:', order._id);
  } catch (error) {
    console.error('Error handling customer.subscription.created:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Subscription created error details:', {
      subscriptionId: subscription?.id,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleSubscriptionDeleted(subscription) {
  console.log('Processing customer.subscription.deleted:', subscription.id);
  
  try {
    // Find the order associated with this subscription
    const order = await SalesOrder.findOne({ stripeSubscriptionId: subscription.id });
    if (!order) {
      console.log('Order not found for subscription deletion:', subscription.id);
      return;
    }

    // Update order status
    order.recurringStatus = 'cancelled';
    order.updatedAt = new Date();
    
    // Add tracking history
    order.trackingHistory.push({
      status: 'subscription_cancelled',
      timestamp: new Date(),
      note: `Subscription cancelled: ${subscription.id}`
    });
    
    await order.save();

    console.log('Subscription deleted successfully for order:', order._id);
  } catch (error) {
    console.error('Error handling customer.subscription.deleted:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Subscription deleted error details:', {
      subscriptionId: subscription?.id,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleSubscriptionPaused(subscription) {
  console.log('Processing customer.subscription.paused:', subscription.id);
  
  try {
    // Find the order associated with this subscription
    const order = await SalesOrder.findOne({ stripeSubscriptionId: subscription.id });
    if (!order) {
      console.log('Order not found for subscription pause:', subscription.id);
      return;
    }

    // Update order status
    order.recurringStatus = 'paused';
    order.updatedAt = new Date();
    
    // Add tracking history
    order.trackingHistory.push({
      status: 'subscription_paused',
      timestamp: new Date(),
      note: `Subscription paused: ${subscription.id}`
    });
    
    await order.save();

    console.log('Subscription paused successfully for order:', order._id);
  } catch (error) {
    console.error('Error handling customer.subscription.paused:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Subscription paused error details:', {
      subscriptionId: subscription?.id,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleSubscriptionResumed(subscription) {
  console.log('Processing customer.subscription.resumed:', subscription.id);
  
  try {
    // Find the order associated with this subscription
    const order = await SalesOrder.findOne({ stripeSubscriptionId: subscription.id });
    if (!order) {
      console.log('Order not found for subscription resume:', subscription.id);
      return;
    }

    // Update order status
    order.recurringStatus = 'active';
    order.nextRecurringDate = new Date(subscription.current_period_end * 1000);
    order.updatedAt = new Date();
    
    // Add tracking history
    order.trackingHistory.push({
      status: 'subscription_resumed',
      timestamp: new Date(),
      note: `Subscription resumed: ${subscription.id}`
    });
    
    await order.save();

    console.log('Subscription resumed successfully for order:', order._id);
  } catch (error) {
    console.error('Error handling customer.subscription.resumed:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Subscription resumed error details:', {
      subscriptionId: subscription?.id,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleSubscriptionUpdated(subscription) {
  console.log('Processing customer.subscription.updated:', subscription.id);
  
  try {
    // Find the order associated with this subscription
    const order = await SalesOrder.findOne({ stripeSubscriptionId: subscription.id });
    if (!order) {
      console.log('Order not found for subscription update:', subscription.id);
      return;
    }

    // Update order data
    const oldStatus = order.recurringStatus;
    order.recurringStatus = subscription.status === 'active' ? 'active' : 
                           subscription.status === 'paused' ? 'paused' : 
                           subscription.status === 'canceled' ? 'cancelled' : 'active';
    order.nextRecurringDate = new Date(subscription.current_period_end * 1000);
    order.updatedAt = new Date();
    
    // Add tracking history if status changed
    if (oldStatus !== order.recurringStatus) {
      order.trackingHistory.push({
        status: 'subscription_updated',
        timestamp: new Date(),
        note: `Subscription status changed from ${oldStatus} to ${order.recurringStatus}`
      });
    }
    
    await order.save();

    console.log('Subscription updated successfully for order:', order._id);
  } catch (error) {
    console.error('Error handling customer.subscription.updated:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Subscription updated error details:', {
      subscriptionId: subscription?.id,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleInvoicePaymentSucceeded(invoice) {
  console.log('Processing invoice.payment_succeeded:', invoice.id);
  
  try {
    // Check if this is a subscription invoice
    if (!invoice.subscription) {
      console.log('Invoice is not related to subscription:', invoice.id);
      return;
    }

    // Find the parent recurring order
    let parentOrder = await SalesOrder.findOne({ 
      stripeSubscriptionId: invoice.subscription,
      isRecurring: true 
    });
    
    if (!parentOrder) {
      console.log('Parent recurring order not found for invoice:', invoice.id);
      return;
    }

    // Check if this is the first invoice (subscription setup) or recurring
    const isFirstInvoice = invoice.billing_reason === 'subscription_create';
    
    if (isFirstInvoice) {
      // Update the parent order for initial subscription
      parentOrder.payment_status = 'paid';
      parentOrder.LocalStatus = 'Confirmed';
      parentOrder.completedRecurringCycles = 1;
      parentOrder.nextRecurringDate = new Date(invoice.period_end * 1000);
      
      // Create payment record for initial subscription payment
      const initialPaymentRecord = new Payment({
        order: parentOrder._id,
        user: parentOrder.user,
        customer: parentOrder.user,
        paymentIntentId: invoice.payment_intent,
        amount: invoice.amount_paid / 100, // Convert from cents
        currency: invoice.currency,
        status: 'succeeded',
        paymentMethod: 'card',
        store: parentOrder.store,
        transactionDetails: {
          orderType: 'recurring',
          isRecurring: true,
          recurringFrequency: parentOrder.recurringFrequency,
          stripeSubscriptionId: parentOrder.stripeSubscriptionId,
          stripeCustomerId: parentOrder.stripeCustomerId
        },
        createdAt: new Date(),
      });
      
      await initialPaymentRecord.save();
      
      // Link payment to parent order
      parentOrder.payment = initialPaymentRecord._id;
      // Use Stripe Payment Intent ID or Subscription ID for Payment_id field
      if (initialPaymentRecord.paymentIntentId) {
        parentOrder.Payment_id = initialPaymentRecord.paymentIntentId;
      } else if (initialPaymentRecord.transactionDetails?.stripeSubscriptionId) {
        parentOrder.Payment_id = initialPaymentRecord.transactionDetails.stripeSubscriptionId;
      } else {
        parentOrder.Payment_id = initialPaymentRecord._id.toString();
      }
      
      parentOrder.trackingHistory.push({
        status: 'subscription_payment_succeeded',
        timestamp: new Date(),
        note: `Initial subscription payment succeeded - Invoice: ${invoice.id}`
      });
      
      await parentOrder.save();
      console.log('Initial subscription payment confirmed for parent order:', parentOrder._id);
    } else {
      // This is a recurring payment - create a new order
      const newOrder = await createRecurringOrder(parentOrder, invoice);
      
      // Update parent order with cycle count and next date
      parentOrder.completedRecurringCycles = (parentOrder.completedRecurringCycles || 0) + 1;
      parentOrder.nextRecurringDate = new Date(invoice.period_end * 1000);
      
      // Check if we've reached the cycle limit
      if (parentOrder.totalRecurringCycles && 
          parentOrder.completedRecurringCycles >= parentOrder.totalRecurringCycles) {
        parentOrder.recurringStatus = 'completed';
        
        // Cancel the subscription in Stripe
        try {
          await stripe.subscriptions.update(parentOrder.stripeSubscriptionId, {
            cancel_at_period_end: true
          });
          console.log('Subscription set to cancel at period end due to cycle limit');
        } catch (stripeError) {
          console.error('Error cancelling subscription:', stripeError);
        }
      }
      
      parentOrder.trackingHistory.push({
        status: 'recurring_payment_succeeded',
        timestamp: new Date(),
        note: `Recurring payment succeeded - Invoice: ${invoice.id}, New Order: ${newOrder._id}, Cycle: ${parentOrder.completedRecurringCycles}`
      });
      
      await parentOrder.save();
      console.log('Recurring payment processed for parent order:', parentOrder._id, 'New order:', newOrder._id);
    }

  } catch (error) {
    console.error('Error handling invoice.payment_succeeded:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Invoice payment succeeded error details:', {
      invoiceId: invoice?.id,
      subscriptionId: invoice?.subscription,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleInvoicePaymentFailed(invoice) {
  console.log('Processing invoice.payment_failed:', invoice.id);
  
  try {
    // Find the parent recurring order
    const parentOrder = await SalesOrder.findOne({ 
      stripeSubscriptionId: invoice.subscription,
      isRecurring: true 
    });
    
    if (!parentOrder) {
      console.log('Parent recurring order not found for failed invoice:', invoice.id);
      return;
    }

    // Update parent order status for failed payment
    parentOrder.payment_status = 'failed';
    parentOrder.LocalStatus = 'PaymentFailed';
    parentOrder.recurringStatus = 'past_due';
    parentOrder.updatedAt = new Date();
    
    // Add tracking history entry for failed payment
    parentOrder.trackingHistory.push({
      status: 'subscription_payment_failed',
      timestamp: new Date(),
      note: `Subscription payment failed - Invoice: ${invoice.id}, Attempt: ${invoice.attempt_count || 1}`
    });
    
    await parentOrder.save();

    console.log('Subscription payment failed handled for order:', parentOrder._id);
  } catch (error) {
    console.error('Error handling invoice.payment_failed:', error);
    // Don't throw error to prevent 503, just log it
    console.error('Invoice payment failed error details:', {
      invoiceId: invoice?.id,
      subscriptionId: invoice?.subscription,
      error: error.message,
      stack: error.stack
    });
  }
}

// Subscription Management Functions
exports.createSubscription = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const { 
      orderId, 
      stripeCustomerId, 
      stripePaymentMethodId, 
      recurringFrequency, 
      recurringInterval = 1,
      totalRecurringCycles = null,
      recurringEndDate = null 
    } = req.body;

    // Find the original order
    const originalOrder = await SalesOrder.findById(orderId);
    if (!originalOrder) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    // Verify the order belongs to the user
    if (originalOrder.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Order does not belong to this user' 
      });
    }

    // Create interval object for Stripe
    let intervalData = {};
    switch (recurringFrequency) {
      case 'weekly':
        intervalData = { interval: 'week', interval_count: recurringInterval };
        break;
      case 'biweekly':
        intervalData = { interval: 'week', interval_count: 2 };
        break;
      case 'monthly':
        intervalData = { interval: 'month', interval_count: recurringInterval };
        break;
      case 'quarterly':
        intervalData = { interval: 'month', interval_count: 3 };
        break;
      default:
        intervalData = { interval: 'month', interval_count: 1 };
    }

    // Create Stripe subscription
    const subscriptionData = {
      customer: stripeCustomerId,
      default_payment_method: stripePaymentMethodId,
      items: originalOrder.orderItems.map(item => ({
        price_data: {
          currency: 'aed',
          product_data: {
            name: item.name,
          },
          unit_amount: Math.round(item.price * 100), // Convert to cents
          recurring: intervalData
        },
        quantity: item.quantity,
      })),
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        orderId: orderId,
        userId: req.user._id.toString(),
        recurringFrequency,
        recurringInterval: recurringInterval.toString(),
        totalRecurringCycles: totalRecurringCycles?.toString() || 'unlimited',
        recurringEndDate: recurringEndDate?.toISOString() || 'unlimited'
      }
    };

    // Add cycle limit if specified
    if (totalRecurringCycles) {
      subscriptionData.cancel_after = totalRecurringCycles;
    }

    const subscription = await stripe.subscriptions.create(subscriptionData);

    // Update the original order with recurring details
    originalOrder.isRecurring = true;
    originalOrder.recurringStatus = 'active';
    originalOrder.recurringFrequency = recurringFrequency;
    originalOrder.recurringInterval = recurringInterval;
    originalOrder.totalRecurringCycles = totalRecurringCycles;
    originalOrder.recurringEndDate = recurringEndDate;
    originalOrder.stripeSubscriptionId = subscription.id;
    originalOrder.stripeCustomerId = stripeCustomerId;
    originalOrder.stripePaymentMethodId = stripePaymentMethodId;
    originalOrder.nextRecurringDate = new Date(subscription.current_period_end * 1000);
    originalOrder.completedRecurringCycles = 0;
    originalOrder.updatedAt = new Date();

    await originalOrder.save();

    res.json({
      success: true,
      subscriptionId: subscription.id,
      orderId: originalOrder._id,
      clientSecret: subscription.latest_invoice.payment_intent?.client_secret,
      message: 'Recurring order created successfully'
    });

  } catch (error) {
    console.error('Error creating recurring order:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create recurring order'
    });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const { orderId } = req.body;

    // Find the order
    const order = await SalesOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    // Verify the order belongs to the user
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Order does not belong to this user' 
      });
    }

    if (!order.stripeSubscriptionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order is not a recurring order' 
      });
    }

    // Cancel the subscription in Stripe
    const subscription = await stripe.subscriptions.update(order.stripeSubscriptionId, {
      cancel_at_period_end: true
    });

    // Update the order
    order.recurringStatus = 'cancelled';
    order.updatedAt = new Date();
    
    // Add tracking history
    order.trackingHistory.push({
      status: 'subscription_cancelled',
      timestamp: new Date(),
      note: 'Subscription cancelled by user'
    });

    await order.save();

    res.json({
      success: true,
      message: 'Recurring order cancelled successfully',
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    });

  } catch (error) {
    console.error('Error cancelling recurring order:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel recurring order'
    });
  }
};

exports.pauseSubscription = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const { orderId } = req.body;

    // Find the order
    const order = await SalesOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    // Verify the order belongs to the user
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Order does not belong to this user' 
      });
    }

    if (!order.stripeSubscriptionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order is not a recurring order' 
      });
    }

    // Pause the subscription in Stripe
    const subscription = await stripe.subscriptions.update(order.stripeSubscriptionId, {
      pause_collection: {
        behavior: 'void'
      }
    });

    // Update the order
    order.recurringStatus = 'paused';
    order.updatedAt = new Date();
    
    // Add tracking history
    order.trackingHistory.push({
      status: 'subscription_paused',
      timestamp: new Date(),
      note: 'Subscription paused by user'
    });

    await order.save();

    res.json({
      success: true,
      message: 'Recurring order paused successfully'
    });

  } catch (error) {
    console.error('Error pausing recurring order:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to pause recurring order'
    });
  }
};

exports.resumeSubscription = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const { orderId } = req.body;

    // Find the order
    const order = await SalesOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    // Verify the order belongs to the user
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Order does not belong to this user' 
      });
    }

    if (!order.stripeSubscriptionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order is not a recurring order' 
      });
    }

    // Resume the subscription in Stripe
    const subscription = await stripe.subscriptions.update(order.stripeSubscriptionId, {
      pause_collection: null
    });

    // Update the order
    order.recurringStatus = 'active';
    order.nextRecurringDate = new Date(subscription.current_period_end * 1000);
    order.updatedAt = new Date();
    
    // Add tracking history
    order.trackingHistory.push({
      status: 'subscription_resumed',
      timestamp: new Date(),
      note: 'Subscription resumed by user'
    });

    await order.save();

    res.json({
      success: true,
      message: 'Recurring order resumed successfully'
    });

  } catch (error) {
    console.error('Error resuming recurring order:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to resume recurring order'
    });
  }
};

exports.getUserSubscriptions = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    // Find all recurring orders for the user
    const subscriptions = await SalesOrder.find({
      user: req.user._id,
      isRecurring: true
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      subscriptions: subscriptions.map(sub => ({
        id: sub._id,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        status: sub.recurringStatus,
        frequency: sub.recurringFrequency,
        interval: sub.recurringInterval,
        nextRecurringDate: sub.nextRecurringDate,
        totalCycles: sub.totalRecurringCycles,
        completedCycles: sub.completedRecurringCycles,
        endDate: sub.recurringEndDate,
        orderItems: sub.orderItems,
        totalPrice: sub.DocTotal,
        createdAt: sub.createdAt
      }))
    });

  } catch (error) {
    console.error('Error getting user recurring orders:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get recurring orders'
    });
  }
};

exports.createPaymentIntent = async (req, res) => {
  try {
    // Add authentication check
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required to create payment intent' 
      });
    }

    const { amount, currency = 'aed', customerInfo, isRecurring = false, recurringFrequency } = req.body;
    
    // Validate required fields
    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid amount is required' 
      });
    }

    if (!customerInfo || !customerInfo.email || !customerInfo.name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Customer information is required' 
      });
    }

    // For recurring orders, create a subscription instead of payment intent
    if (isRecurring) {
      return await createSubscription(req, res, amount, currency, customerInfo, recurringFrequency);
    }

    let stripeCustomerId = null;

    // Create payment intent with metadata
    const paymentIntentData = {
      amount,
      currency,
      metadata: {
        email: customerInfo.email,
        name: customerInfo.name,
        userId: req.user._id.toString(),
        userRole: req.user.role,
      },
    };

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);

    console.log('Payment intent created:', paymentIntent.id, 'Currency:', currency);

    res.json({ 
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      stripeCustomerId: null
    });
  } catch (err) {
    console.error('Error creating payment intent:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message || 'Failed to create payment intent'
    });
  }
};

// Helper function to create subscription for recurring orders
async function createSubscription(req, res, amount, currency, customerInfo, recurringFrequency) {
  try {
    console.log('Creating subscription with:', { amount, currency, customerInfo, recurringFrequency });
    let stripeCustomerId = null;

    // Check if customer already exists
    const existingCustomers = await stripe.customers.list({
      email: customerInfo.email,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      stripeCustomerId = existingCustomers.data[0].id;
      console.log('Using existing Stripe customer:', stripeCustomerId);
      
      // Check if customer has a default payment method
      const customer = await stripe.customers.retrieve(stripeCustomerId, {
        expand: ['invoice_settings.default_payment_method']
      });
      
      if (!customer.invoice_settings.default_payment_method) {
        console.log('Customer has no default payment method, creating setup intent');
        // Create setup intent for customer to add payment method
        const setupIntent = await stripe.setupIntents.create({
          customer: stripeCustomerId,
          payment_method_types: ['card'],
          usage: 'off_session',
          metadata: {
            userId: req.user._id.toString(),
            email: customerInfo.email,
            recurringFrequency: recurringFrequency,
            amount: amount.toString(),
            currency: currency
          }
        });

        res.json({ 
          success: true,
          clientSecret: setupIntent.client_secret,
          setupIntentId: setupIntent.id,
          stripeCustomerId: stripeCustomerId,
          requiresSetup: true,
          message: 'Please add a payment method to continue with subscription'
        });
        return;
      }
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: customerInfo.email,
        name: customerInfo.name,
        phone: customerInfo.phone,
        address: customerInfo.address,
        metadata: {
          userId: req.user._id.toString(),
          userRole: req.user.role,
        }
      });
      stripeCustomerId = customer.id;
      console.log('Created new Stripe customer:', stripeCustomerId);
      
      // For new customers, always create setup intent first
      console.log('New customer, creating setup intent for payment method');
      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        usage: 'off_session',
        metadata: {
          userId: req.user._id.toString(),
          email: customerInfo.email,
          recurringFrequency: recurringFrequency,
          amount: amount.toString(),
          currency: currency
        }
      });

      res.json({ 
        success: true,
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        stripeCustomerId: stripeCustomerId,
        requiresSetup: true,
        message: 'Please add a payment method to continue with subscription'
      });
      return;
    }

    // If we reach here, customer has a default payment method
    console.log('Customer has default payment method, creating subscription directly');
    
    // Create a product for the subscription
    const product = await stripe.products.create({
      name: 'Premium Quality Foods Subscription',
      description: `Recurring order - ${recurringFrequency}`,
    });

    // Create a price for the subscription
    const interval = getIntervalFromFrequency(recurringFrequency);
    const intervalCount = getIntervalCountFromFrequency(recurringFrequency);
    console.log('Creating price with interval:', interval, 'interval_count:', intervalCount);
    console.log('Price amount:', amount, 'currency:', currency);
    
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: amount,
      currency: currency,
      recurring: {
        interval: interval,
        interval_count: intervalCount,
      },
    });
    
    console.log('Price created:', price.id, 'Amount:', price.unit_amount, 'Currency:', price.currency);

    // Create subscription with proper setup
    console.log('Creating subscription with price ID:', price.id);
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: price.id }],
      payment_settings: { 
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card']
      },
      collection_method: 'charge_automatically',
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        userId: req.user._id.toString(),
        userRole: req.user.role,
        email: customerInfo.email,
        name: customerInfo.name,
        recurringFrequency: recurringFrequency
      },
    });

    console.log('Subscription created:', subscription.id, 'Customer:', stripeCustomerId);
    console.log('Subscription status:', subscription.status);
    console.log('Latest invoice status:', subscription.latest_invoice?.status);

    // Check subscription status and handle accordingly
    if (subscription.status === 'incomplete') {
      // Subscription needs payment method setup
      const paymentIntent = subscription.latest_invoice?.payment_intent;
      
      if (paymentIntent) {
        console.log('Payment intent found for incomplete subscription:', paymentIntent.id);
        res.json({ 
          success: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          stripeCustomerId: stripeCustomerId,
          subscriptionId: subscription.id,
          paymentIntentStatus: paymentIntent.status,
          subscriptionStatus: subscription.status
        });
      } else {
        // No payment intent - create a setup intent instead
        console.log('No payment intent found, creating setup intent for subscription setup');
        const setupIntent = await stripe.setupIntents.create({
          customer: stripeCustomerId,
          payment_method_types: ['card'],
          usage: 'off_session',
          metadata: {
            subscriptionId: subscription.id,
            userId: req.user._id.toString()
          }
        });

        res.json({ 
          success: true,
          clientSecret: setupIntent.client_secret,
          setupIntentId: setupIntent.id,
          stripeCustomerId: stripeCustomerId,
          subscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          requiresSetup: true
        });
      }
    } else if (subscription.status === 'active') {
      // Subscription is already active
      console.log('Subscription is already active');
      res.json({ 
        success: true,
        subscriptionId: subscription.id,
        stripeCustomerId: stripeCustomerId,
        subscriptionStatus: subscription.status,
        message: 'Subscription created and activated successfully'
      });
    } else {
      // Handle other statuses
      console.log('Unexpected subscription status:', subscription.status);
      const paymentIntent = subscription.latest_invoice?.payment_intent;
      
      if (paymentIntent) {
        res.json({ 
          success: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          stripeCustomerId: stripeCustomerId,
          subscriptionId: subscription.id,
          paymentIntentStatus: paymentIntent.status,
          subscriptionStatus: subscription.status
        });
      } else {
        throw new Error(`Subscription created with status ${subscription.status} but no payment intent available`);
      }
    }

  } catch (err) {
    console.error('Error creating subscription:', err);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create subscription';
    if (err.message.includes('payment_behavior')) {
      errorMessage = 'Payment setup configuration error. Please try again.';
    } else if (err.message.includes('payment_intent')) {
      errorMessage = 'Payment processing setup failed. Please check your payment details.';
    } else if (err.type === 'StripeCardError') {
      errorMessage = 'Card error: ' + err.message;
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      details: err.message
    });
  }
}

// Helper function to convert frequency to Stripe interval
function getIntervalFromFrequency(frequency) {
  switch (frequency) {
    case 'weekly':
      return 'week';
    case 'biweekly':
      return 'week';
    case 'monthly':
      return 'month';
    case 'quarterly':
      return 'month';
    default:
      return 'month';
  }
}

// Helper function to get interval count for Stripe
function getIntervalCountFromFrequency(frequency) {
  switch (frequency) {
    case 'weekly':
      return 1;
    case 'biweekly':
      return 2;
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    default:
      return 1;
  }
}

exports.createOrderAfterPayment = async (req, res) => {
  try {
    // DEBUG: Log request details
    console.log('=== CREATE ORDER DEBUG ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Content-Type:', req.get('Content-Type'));
    console.log('Body exists:', !!req.body);
    console.log('Body type:', typeof req.body);
    console.log('Body keys:', req.body ? Object.keys(req.body) : 'NO BODY');
    console.log('Raw body preview:', req.body ? JSON.stringify(req.body).substring(0, 200) : 'NO BODY');
    console.log('User exists:', !!req.user);
    console.log('User ID:', req.user?._id);
    console.log('========================');

    // Check if body is missing
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is missing or empty',
        error: 'No data received',
        debug: {
          contentType: req.get('Content-Type'),
          method: req.method,
          hasBody: !!req.body
        }
      });
    }

    console.log('--- [createOrderAfterPayment] Starting ---');
    console.log('User ID:', req.user._id);
    console.log('User Role:', req.user.role);
    console.log('User Status:', req.user.status);

    const { paymentIntentId, orderData, customerInfo } = req.body;

    // REMOVED: Early return for recurring orders with card payment
    // The order should be created immediately, not waiting for webhook

    // Validate required data
    if (!orderData || !customerInfo) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order data and customer info are required' 
      });
    }

    if (!orderData.orderItems || orderData.orderItems.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order must contain at least one item' 
      });
    }

    // Validate order type
    if (!orderData.orderType || !['one-time', 'recurring'].includes(orderData.orderType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order type must be either "one-time" or "recurring"' 
      });
    }

    // Validate recurring order data if it's a recurring order
    if (orderData.orderType === 'recurring') {
      if (!orderData.recurringFrequency || !['weekly', 'biweekly', 'monthly', 'quarterly'].includes(orderData.recurringFrequency)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Recurring frequency is required and must be weekly, biweekly, monthly, or quarterly' 
        });
      }
      // Only require stripeCustomerId for card payments
      if (orderData.paymentMethod === 'card' && !orderData.stripeCustomerId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Stripe customer ID is required for recurring card payments' 
        });
      }
    }

    let paymentIntent = null;
    
    // Handle different payment methods
    if (orderData.paymentMethod === 'card') {
      // For recurring orders, we might not have paymentIntentId (using setup intents)
      if (!paymentIntentId && orderData.orderType === 'recurring') {
        // Check if we have subscription ID or setup intent data
        if (orderData.stripeSubscriptionId || orderData.setupIntentId) {
          console.log('Recurring order with subscription/setup intent, no payment intent needed');
          // Payment is already confirmed via subscription or setup intent
        } else {
          return res.status(400).json({ 
            success: false, 
            message: 'Subscription ID or setup intent ID is required for recurring card payments' 
          });
        }
      } else if (!paymentIntentId && orderData.orderType !== 'recurring') {
        return res.status(400).json({ 
          success: false, 
          message: 'Payment intent ID is required for one-time card payments' 
        });
      }

      if (paymentIntentId) {
        try {
          paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
          console.log('Payment intent status:', paymentIntent.status);
          
          // Check if payment is successful or processing
          console.log('Payment intent charges:', paymentIntent.charges?.data?.map(c => ({ id: c.id, status: c.status })));
          
          if (paymentIntent.status === 'succeeded') {
            // Payment is confirmed
            console.log('Payment confirmed via status check');
          } else if (paymentIntent.status === 'processing') {
            // Payment is being processed, we can proceed with order creation
            console.log('Payment is processing, proceeding with order creation');
          } else if (paymentIntent.status === 'requires_payment_method') {
            // Check if there are any successful charges
            const charges = paymentIntent.charges?.data || [];
            const hasSuccessfulCharge = charges.some(charge => charge.status === 'succeeded');
            
            if (hasSuccessfulCharge) {
              console.log('Payment confirmed via charge status');
            } else {
              console.log('No successful charges found, payment not confirmed');
              return res.status(400).json({ 
                success: false, 
                error: 'Payment not successful',
                paymentStatus: paymentIntent.status
              });
            }
          } else {
            console.log('Payment status not acceptable:', paymentIntent.status);
            return res.status(400).json({ 
              success: false, 
              error: 'Payment not successful',
              paymentStatus: paymentIntent.status
            });
          }

          // Verify the payment belongs to this user
          if (paymentIntent.metadata.userId !== req.user._id.toString()) {
            return res.status(403).json({ 
              success: false, 
              message: 'Payment intent does not belong to this user' 
            });
          }
        } catch (stripeError) {
          console.error('Error retrieving payment intent:', stripeError);
          return res.status(400).json({ 
            success: false, 
            error: 'Unable to verify payment' 
          });
        }
      }
    }

    const userId = req.user._id;

    // Prepare document lines for SAP integration
    const DocumentLines = orderData.orderItems.map((item, idx) => ({
      LineNum: idx,
      ItemDescription: item.name || 'Unknown Item',
      Quantity: item.quantity || 1,
      Price: item.price || 0,
      ItemCode: item.product || '',
    }));

    // Determine payment and order status based on SalesOrder enum values
    let paymentStatus, localStatus;
    switch (orderData.paymentMethod) {
      case 'card':
        // For recurring orders with active subscription or setup intent
        if (orderData.orderType === 'recurring' && (orderData.stripeSubscriptionId || orderData.setupIntentId) && !paymentIntent) {
          paymentStatus = 'paid';
          localStatus = 'Created';
          console.log('Recurring order with subscription/setup intent, payment already confirmed');
        } else if (paymentIntent) {
          // Check if payment is confirmed
          const hasSuccessfulCharge = paymentIntent?.charges?.data?.some(charge => charge.status === 'succeeded');
          const isPaymentConfirmed = paymentIntent && (paymentIntent.status === 'succeeded' || 
              (paymentIntent.status === 'requires_payment_method' && hasSuccessfulCharge) ||
              paymentIntent.status === 'processing');
          
          console.log('Payment confirmation check:', {
            paymentIntentStatus: paymentIntent?.status,
            hasSuccessfulCharge,
            isPaymentConfirmed
          });
          
          if (isPaymentConfirmed) {
            paymentStatus = 'paid';
            localStatus = 'Created';
            console.log('Payment confirmed, setting status to paid');
          } else {
            paymentStatus = 'pending';
            localStatus = 'Created';
            console.log('Payment not confirmed, setting status to pending');
          }
        } else {
          paymentStatus = 'pending';
          localStatus = 'Created';
        }
        break;
      case 'cash':
        paymentStatus = 'pending_cash';
        localStatus = 'Created';
        break;
      case 'cheque':
        paymentStatus = 'pending_cheque';
        localStatus = 'Created';
        break;
      case 'bank_transfer':
        paymentStatus = 'pending_bank_transfer';
        localStatus = 'Created';
        break;
      default:
        paymentStatus = 'pending';
        localStatus = 'Created';
    }

    // Generate unique tracking number
    const trackingNumber = generateTrackingNumber();
    console.log('Generated tracking number:', trackingNumber);

    // Create the sales order
    const order = new SalesOrder({
      DocEntry: Date.now(), // Temporary ID until SAP sync
      CardName: customerInfo.name,
      CardCode: userId, // Use userId directly
      payment_status: paymentStatus,
      Payment_id: paymentIntentId || null,
      SyncedWithSAP: false,
      LocalStatus: localStatus,
      DocumentLines,
      Address: orderData.shippingAddress?.address || '',
      Address2: orderData.billingAddress?.address || '',
      Comments: orderData.notes || '',
      DocTotal: orderData.totalPrice || 0,
      orderItems: orderData.orderItems,
      shippingAddress: orderData.shippingAddress,
      billingAddress: orderData.billingAddress,
      notes: orderData.notes,
      orderType: orderData.deliveryMethod || 'delivery',
      pickupStore: orderData.deliveryMethod === 'pickup' ? orderData.pickupStore : null,
      store: orderData.store || null,
      user: userId,
      trackingNumber: trackingNumber,
      trackingStatus: 'pending',
      trackingHistory: [
        {
          status: 'pending',
          timestamp: new Date(),
          note: `Order placed with ${orderData.paymentMethod} payment${orderData.paymentMethod === 'card' ? ' - Payment confirmed' : ' - Payment pending'}`
        }
      ],
      paymentMethod: orderData.paymentMethod,
      createdAt: new Date(),
    });

    // Set recurring order fields if it's a recurring order
    if (orderData.orderType === 'recurring') {
      order.isRecurring = true;
      order.recurringStatus = 'active';
      order.recurringFrequency = orderData.recurringFrequency;
      order.recurringInterval = orderData.recurringInterval || 1;
      order.totalRecurringCycles = orderData.totalRecurringCycles || null;
      order.recurringEndDate = orderData.recurringEndDate || null;
      // Only set Stripe fields for card payments
      if (orderData.paymentMethod === 'card') {
        order.stripeCustomerId = orderData.stripeCustomerId;
        order.stripePaymentMethodId = orderData.stripePaymentMethodId;
        order.stripeSubscriptionId = orderData.stripeSubscriptionId;
      }
      order.completedRecurringCycles = 0;
      order.generatedFromRecurring = false;
    } else {
      // One-time order
      order.isRecurring = false;
      order.generatedFromRecurring = false;
    }

    await order.save();
    console.log('Order created:', order._id, 'Tracking:', trackingNumber);

    // Update subscription metadata if it's a recurring order with subscription
    if (order.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.update(order.stripeSubscriptionId, {
          metadata: {
            orderId: order._id.toString(),
            userId: req.user._id.toString(),
            orderNumber: order.DocEntry.toString(),
            trackingNumber: trackingNumber
          }
        });
        console.log('Updated subscription metadata with order ID');
      } catch (metadataError) {
        console.error('Error updating subscription metadata:', metadataError);
        // Don't fail the order creation
      }
    }

    // Check if payment record already exists for this order
    let paymentRecord = await Payment.findOne({ order: order._id });
    
    if (!paymentRecord) {
      // Create new payment record only if it doesn't exist
      paymentRecord = new Payment({
        order: order._id,
        user: userId,
        customer: userId, // Use userId instead of customerId
        paymentIntentId: paymentIntentId || null,
        amount: orderData.totalPrice || 0,
        currency: paymentIntent?.currency || 'aed',
        status: orderData.paymentMethod === 'card' ? paymentStatus : 'pending',
        paymentMethod: orderData.paymentMethod,
        receiptUrl: paymentIntent?.charges?.data?.[0]?.receipt_url || null,
        store: orderData.store || null,
        // Add transaction details for better history
        transactionDetails: {
          orderType: orderData.orderType,
          isRecurring: orderData.orderType === 'recurring',
          recurringFrequency: orderData.orderType === 'recurring' ? orderData.recurringFrequency : null,
          stripeSubscriptionId: orderData.stripeSubscriptionId || null,
          stripeCustomerId: orderData.stripeCustomerId || null
        },
        createdAt: new Date(),
      });
      
      await paymentRecord.save();
      console.log('Payment record created:', paymentRecord._id);
    } else {
      if (paymentIntentId && !paymentRecord.paymentIntentId) {
        paymentRecord.paymentIntentId = paymentIntentId;
        paymentRecord.status = 'paid';
        paymentRecord.updatedAt = new Date();
        await paymentRecord.save();
        console.log('Payment record updated with payment intent ID:', paymentRecord._id);
      }
    }
    if (paymentRecord && paymentRecord._id) {
      order.payment = paymentRecord._id;
      if (paymentRecord.paymentIntentId) {
        order.Payment_id = paymentRecord.paymentIntentId;
      } else if (orderData.stripeSubscriptionId && orderData.orderType === 'recurring') {
        order.Payment_id = orderData.stripeSubscriptionId;
      } else {
        order.Payment_id = paymentRecord._id.toString();
      }
      await order.save();
      console.log('Payment linked to order:', order._id, 'Payment Intent ID:', paymentRecord.paymentIntentId, 'Payment Record ID:', paymentRecord._id);
    } else {
      console.error('No payment record to link to order:', order._id);
    }

    // Clear user's cart
    try {
      await Cart.updateMany(
        { user: userId, status: 'active' },
        { 
          status: 'checked_out',
          checkedOutAt: new Date(),
          relatedOrder: order._id
        }
      );
      console.log('User cart(s) marked as checked out');
    } catch (cartErr) {
      console.error('Error updating cart status:', cartErr);
      // Don't fail the entire request
    }

    // Send order confirmation email
    try {
      const emailData = {
        orderId: order._id,
        orderType: orderData.deliveryMethod || 'delivery',
        paymentMethod: orderData.paymentMethod,
        paymentStatus: paymentStatus,
        trackingNumber: trackingNumber,
        totalPrice: orderData.totalPrice || 0,
        orderItems: orderData.orderItems,
        shippingAddress: orderData.shippingAddress,
        billingAddress: orderData.billingAddress,
        isRecurring: orderData.orderType === 'recurring',
        recurringFrequency: orderData.orderType === 'recurring' ? orderData.recurringFrequency : null
      };
      
      await sendOrderConfirmationEmail(
        customerInfo.email,
        emailData,
        customerInfo.name
      );
      console.log('Order confirmation email sent successfully');
    } catch (emailError) {
      console.error('Error sending order confirmation email:', emailError);
      // Don't fail the order creation if email fails
    }

    // Success response
    const responseMessage = orderData.orderType === 'recurring' 
      ? `Recurring order placed successfully! ${orderData.paymentMethod === 'card' ? 'Your subscription is active.' : orderData.paymentMethod === 'bank_transfer' ? 'Awaiting bank transfer confirmation.' : 'Payment pending.'}`
      : `Order placed successfully! ${orderData.paymentMethod === 'card' ? 'Payment confirmed.' : orderData.paymentMethod === 'bank_transfer' ? 'Awaiting bank transfer confirmation.' : 'Payment pending.'}`;

    const response = { 
      success: true, 
      orderId: order._id,
      orderNumber: order.DocEntry,
      trackingNumber: trackingNumber,
      paymentStatus: paymentStatus,
      localStatus: localStatus,
      orderType: orderData.orderType,
      isRecurring: orderData.orderType === 'recurring',
      message: responseMessage,
      estimatedDelivery: orderData.deliveryMethod === 'delivery' ? '3-5 business days' : 'Ready for pickup'
    };

    res.status(201).json(response);

  } catch (err) {
    console.error('Error in createOrderAfterPayment:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message || 'Failed to create order',
      message: 'An unexpected error occurred while processing your order'
    });
  }
};

exports.activateSubscription = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const { subscriptionId, paymentMethodId, setupIntentId, customerInfo, amount, currency, recurringFrequency } = req.body;

    // If we have setup intent data, we need to create a subscription
    if (setupIntentId && customerInfo && amount && currency && recurringFrequency) {
      console.log('Creating subscription after setup intent confirmation');
      
      // Get the customer from the setup intent
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      const stripeCustomerId = setupIntent.customer;
      
      // Set the payment method as default for the customer
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
      
      // Create a product for the subscription
      const product = await stripe.products.create({
        name: 'Premium Quality Foods Subscription',
        description: `Recurring order - ${recurringFrequency}`,
      });

      // Create a price for the subscription
      const interval = getIntervalFromFrequency(recurringFrequency);
      const intervalCount = getIntervalCountFromFrequency(recurringFrequency);
      
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: amount,
        currency: currency,
        recurring: {
          interval: interval,
          interval_count: intervalCount,
        },
      });

      // Create the subscription
      const subscription = await stripe.subscriptions.create({
        customer: stripeCustomerId,
        items: [{ price: price.id }],
        payment_settings: { 
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card']
        },
        collection_method: 'charge_automatically',
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          userId: req.user._id.toString(),
          userRole: req.user.role,
          email: customerInfo.email,
          name: customerInfo.name,
          recurringFrequency: recurringFrequency
        },
      });

      console.log('Subscription created after setup intent:', subscription.id);
      
      res.json({
        success: true,
        subscriptionId: subscription.id,
        stripeCustomerId: stripeCustomerId,
        status: subscription.status,
        message: 'Subscription created and activated successfully'
      });
      return;
    }

    // Original logic for existing subscription
    if (!subscriptionId || !paymentMethodId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Subscription ID and payment method ID are required' 
      });
    }

    // Update the subscription with the payment method
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      default_payment_method: paymentMethodId,
    });

    // If subscription is still incomplete, try to pay the first invoice
    if (subscription.status === 'incomplete') {
      const invoice = await stripe.invoices.retrieve(subscription.latest_invoice);
      
      if (invoice.status === 'open') {
        try {
          await stripe.invoices.pay(invoice.id);
          console.log('First invoice paid successfully');
        } catch (payError) {
          console.error('Error paying first invoice:', payError);
          return res.status(400).json({ 
            success: false, 
            error: 'Failed to process first payment: ' + payError.message 
          });
        }
      }
    }

    // Retrieve updated subscription
    const updatedSubscription = await stripe.subscriptions.retrieve(subscriptionId);

    res.json({
      success: true,
      subscriptionId: updatedSubscription.id,
      status: updatedSubscription.status,
      message: 'Subscription activated successfully'
    });

  } catch (error) {
    console.error('Error activating subscription:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to activate subscription'
    });
  }
};

// Clean up duplicate payment records
exports.cleanupDuplicatePayments = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Admin access required' 
      });
    }

    // Find orders with multiple payment records
    const ordersWithMultiplePayments = await Payment.aggregate([
      {
        $group: {
          _id: '$order',
          count: { $sum: 1 },
          payments: { $push: '$$ROOT' }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);

    let cleanedCount = 0;

    for (const orderGroup of ordersWithMultiplePayments) {
      const payments = orderGroup.payments;
      
      // Keep the payment with paymentIntentId if available, otherwise keep the first one
      const paymentToKeep = payments.find(p => p.paymentIntentId) || payments[0];
      const paymentsToDelete = payments.filter(p => p._id.toString() !== paymentToKeep._id.toString());
      
      // Delete duplicate payments
      for (const payment of paymentsToDelete) {
        await Payment.findByIdAndDelete(payment._id);
        cleanedCount++;
      }
      
      // Update order to link to the kept payment
      await SalesOrder.findByIdAndUpdate(orderGroup._id, {
        payment: paymentToKeep._id
      });
    }

    res.json({
      success: true,
      message: `Cleaned up ${cleanedCount} duplicate payment records`,
      processedOrders: ordersWithMultiplePayments.length
    });

  } catch (error) {
    console.error('Error cleaning up duplicate payments:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cleanup duplicate payments'
    });
  }
};