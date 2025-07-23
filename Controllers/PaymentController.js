const stripe = require('../Config/stripe');
const SalesOrder = require('../Models/SalesOrder');
const Customer = require('../Models/Customer');
const Payment = require('../Models/Payment');
const Cart = require('../Models/Cart');
const User = require('../Models/User');

// Function to generate tracking number
const generateTrackingNumber = () => {
  const prefix = 'PQF'; // Premium Quality Foods
  const timestamp = Date.now().toString().slice(-8); // Last 8 digits of timestamp
  const random = Math.random().toString(36).substring(2, 6).toUpperCase(); // 4 random characters
  return `${prefix}${timestamp}${random}`;
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

    const { amount, currency = 'aed', customerInfo } = req.body;
    
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

    // Create payment intent with metadata
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      metadata: {
        email: customerInfo.email,
        name: customerInfo.name,
        userId: req.user._id.toString(),
        userRole: req.user.role,
      },
    });

    console.log('Payment intent created:', paymentIntent.id, 'Currency:', currency);

    res.json({ 
      success: true,
      clientSecret: paymentIntent.client_secret 
    });
  } catch (err) {
    console.error('Error creating payment intent:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message || 'Failed to create payment intent'
    });
  }
};

exports.createOrderAfterPayment = async (req, res) => {
  try {
    console.log('--- [createOrderAfterPayment] Starting ---');
    console.log('User ID:', req.user._id);
    console.log('User Role:', req.user.role);
    console.log('User Status:', req.user.status);

    const { paymentIntentId, orderData, customerInfo } = req.body;

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

    let paymentIntent = null;
    
    // Handle different payment methods
    if (orderData.paymentMethod === 'card') {
      if (!paymentIntentId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Payment intent ID is required for card payments' 
        });
      }

      try {
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        console.log('Payment intent status:', paymentIntent.status);
        
        if (paymentIntent.status !== 'succeeded') {
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

    let customerId;
    const userId = req.user._id;

    // Handle customer creation/retrieval
    if (req.user.customer) {
      customerId = req.user.customer;
      console.log('Using existing customer:', customerId);
    } else {
      try {
        // Create new customer
        const customer = new Customer({
          name: customerInfo.name,
          email: customerInfo.email,
          phone: customerInfo.phone,
          user: userId, // Link customer to user
        });
        await customer.save();
        customerId = customer._id;
        
        // Update user with customer reference
        await User.findByIdAndUpdate(req.user._id, { customer: customerId });
        console.log('Created new customer:', customerId);
      } catch (customerError) {
        console.error('Error creating customer:', customerError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to create customer record' 
        });
      }
    }

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
        paymentStatus = 'paid';
        localStatus = 'Created'; // Valid enum value from SalesOrder schema
        break;
      case 'cash':
        paymentStatus = 'pending_cash';
        localStatus = 'Created'; // Valid enum value from SalesOrder schema
        break;
      case 'cheque':
        paymentStatus = 'pending_cheque';
        localStatus = 'Created'; // Valid enum value from SalesOrder schema
        break;
      case 'bank_transfer':
        paymentStatus = 'pending_bank_transfer';
        localStatus = 'Created'; // Valid enum value from SalesOrder schema
        break;
      default:
        paymentStatus = 'pending';
        localStatus = 'Created'; // Valid enum value from SalesOrder schema
    }

    // Generate unique tracking number
    const trackingNumber = generateTrackingNumber();
    console.log('Generated tracking number:', trackingNumber);

    // Create the sales order
    const order = new SalesOrder({
      DocEntry: Date.now(), // Temporary ID until SAP sync
      CardName: customerInfo.name,
      CardCode: customerId,
      payment_status: paymentStatus,
      Payment_id: paymentIntentId || null,
      SyncedWithSAP: false,
      LocalStatus: localStatus, // Using correct enum value
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
      trackingNumber: trackingNumber, // Add tracking number
      trackingStatus: 'pending',
      trackingHistory: [
        {
          status: 'pending',
          timestamp: new Date(),
          note: `Order placed with ${orderData.paymentMethod} payment${orderData.paymentMethod === 'card' ? ' - Payment confirmed' : ' - Payment pending'}`
        }
      ],
      createdAt: new Date(),
    });

    await order.save();
    console.log('Order created:', order._id, 'Tracking:', trackingNumber);

    // Create payment record
    const paymentRecord = new Payment({
      order: order._id,
      user: userId,
      customer: customerId,
      paymentIntentId: paymentIntentId || null,
      amount: orderData.totalPrice || 0,
      currency: paymentIntent?.currency || 'aed', // Changed default from 'eur' to 'aed'
      status: orderData.paymentMethod === 'card' ? 'succeeded' : 'pending',
      paymentMethod: orderData.paymentMethod,
      receiptUrl: paymentIntent?.charges?.data?.[0]?.receipt_url || null,
      store: orderData.store || null,
      createdAt: new Date(),
    });

    await paymentRecord.save();
    console.log('Payment record created:', paymentRecord._id);

    // Link payment to order
    order.payment = paymentRecord._id;
    await order.save();

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

    // Success response
    res.status(201).json({ 
      success: true, 
      orderId: order._id,
      orderNumber: order.DocEntry,
      trackingNumber: trackingNumber, // Include tracking number in response
      paymentStatus: paymentStatus,
      localStatus: localStatus,
      message: `Order placed successfully! ${orderData.paymentMethod === 'card' ? 'Payment confirmed.' : orderData.paymentMethod === 'bank_transfer' ? 'Awaiting bank transfer confirmation.' : 'Payment pending.'}`,
      estimatedDelivery: orderData.deliveryMethod === 'delivery' ? '3-5 business days' : 'Ready for pickup'
    });

  } catch (err) {
    console.error('Error in createOrderAfterPayment:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message || 'Failed to create order',
      message: 'An unexpected error occurred while processing your order'
    });
  }
};