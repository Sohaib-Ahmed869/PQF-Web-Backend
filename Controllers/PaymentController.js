const stripe = require('../Config/stripe');
const SalesOrder = require('../Models/SalesOrder');
const Customer = require('../Models/Customer');
const Payment = require('../Models/Payment');
const Cart = require('../Models/Cart');
const User = require('../Models/User');



exports.createPaymentIntent = async (req, res) => {
  try {
    const { amount, currency = 'eur', customerInfo } = req.body;
    // amount in cents
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      metadata: {
        email: customerInfo.email,
        name: customerInfo.name,
      },
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createOrderAfterPayment = async (req, res) => {
  try {
    console.log('--- [createOrderAfterPayment] Incoming request ---');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    const { paymentIntentId, orderData, customerInfo } = req.body;
    // 1. Verify payment
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    console.log('Stripe PaymentIntent:', paymentIntent);
    if (paymentIntent.status !== 'succeeded') {
      console.error('Payment not successful:', paymentIntent.status);
      return res.status(400).json({ error: 'Payment not successful' });
    }

    let customerId;
    let userId = null;
    // 2. If user is logged in, use their linked Customer record
    if (req.user && req.user.customer) {
      customerId = req.user.customer;
      userId = req.user._id;
      console.log('Authenticated user:', userId, 'Customer:', customerId);
    } else {
      // Not logged in: check if user exists by email
      let guestUser = await User.findOne({ email: customerInfo.email });
      if (!guestUser) {
        // Create guest user
        guestUser = new User({
          name: customerInfo.name,
          email: customerInfo.email,
          phone: customerInfo.phone,
          role: 'customer',
          status: 'guest',
          password: Math.random().toString(36).slice(-8), // random 8-char password
          termsAndConditions: { agreed: false, version: '1.0' },
          privacyPolicy: { agreed: false, version: '1.0' },
        });
        // Save address for guest user
        if (orderData.shippingAddress) {
          const addressObj = {
            name: customerInfo.name,
            street: orderData.shippingAddress.address,
            city: orderData.shippingAddress.city,
            state: orderData.shippingAddress.state,
            zipCode: orderData.shippingAddress.postalCode,
            country: orderData.shippingAddress.country,
            isDefault: true
          };
          guestUser.addresses = [addressObj];
        }
        await guestUser.save();
        // Set default shipping/billing address
        if (guestUser.addresses && guestUser.addresses.length > 0) {
          guestUser.shippingAddress = guestUser.addresses[0]._id;
          guestUser.billingAddress = guestUser.addresses[0]._id;
          await guestUser.save();
        }
        // Create guest customer
        const guest = new Customer({
          CardName: customerInfo.name,
          Email: customerInfo.email,
          phoneNumber: customerInfo.phone,
          address: customerInfo.address,
          customerType: 'non-sap',
          status: 'active',
          user: guestUser._id,
        });
        await guest.save();
        // Link user to customer
        guestUser.customer = guest._id;
        await guestUser.save();
        customerId = guest._id;
        userId = guestUser._id;
        console.log('Created guest user and customer:', userId, customerId);
      } else {
        // User exists, use their customer if available
        userId = guestUser._id;
        customerId = guestUser.customer;
        // If no customer, create one
        if (!customerId) {
          const guest = new Customer({
            CardName: customerInfo.name,
            Email: customerInfo.email,
            phoneNumber: customerInfo.phone,
            address: customerInfo.address,
            customerType: 'non-sap',
            status: 'active',
            user: guestUser._id,
          });
          await guest.save();
          guestUser.customer = guest._id;
          await guestUser.save();
          customerId = guest._id;
          console.log('Created customer for existing user:', userId, customerId);
        } else {
          console.log('Found existing user and customer:', userId, customerId);
        }
      }
    }
    const DocumentLines = (orderData.orderItems || []).map((item, idx) => ({
      LineNum: idx,
      ItemDescription: item.name,
      Quantity: item.quantity,
      Price: item.price,
      ItemCode: item.product,
      // Add more mappings as needed
    }));
    console.log('DocumentLines:', DocumentLines);

    const order = new SalesOrder({
      DocEntry: Date.now(),
      CardName: customerInfo.name,
      CardCode: customerId,
      payment_status: 'paid',
      Payment_id: paymentIntentId,
      SyncedWithSAP: false,
      LocalStatus: 'Created',
      DocumentLines,
      Address: orderData.shippingAddress?.address,
      Address2: orderData.billingAddress?.address,
      Comments: orderData.notes,
      DocTotal: orderData.totalPrice,
      orderItems: orderData.orderItems,
      shippingAddress: orderData.shippingAddress,
      billingAddress: orderData.billingAddress,
      notes: orderData.notes,
      orderType: orderData.deliveryMethod || 'delivery',
      pickupStore: orderData.deliveryMethod === 'pickup' ? orderData.pickupStore || null : null,
      store: orderData.store || null,
      user: userId,
      trackingStatus: 'pending',
    });
    await order.save();
    console.log('Order saved:', order._id);

    // 4. Save payment record
    const paymentRecord = new Payment({
      order: order._id,
      user: userId,
      customer: customerId,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount / 100, // Stripe amount is in cents
      currency: paymentIntent.currency,
      status: paymentIntent.status,
      paymentMethod: 'stripe',
      receiptUrl: paymentIntent.charges?.data?.[0]?.receipt_url || null,
      store: orderData.store || null,
    });
    await paymentRecord.save();
    console.log('Payment record saved:', paymentRecord._id);

    // 5. Update order with payment reference
    order.payment = paymentRecord._id;
    await order.save();
    console.log('Order updated with payment reference:', order._id);

    // 6. Mark user's active cart as checked out
    try {
      const userCart = await Cart.findOne({ user: userId, status: 'active' });
      if (userCart) {
        userCart.markAsCheckedOut();
        await userCart.save();
        console.log('User cart marked as checked out:', userCart._id);
      } else {
        console.log('No active cart found for user:', userId);
      }
    } catch (cartErr) {
      console.error('Error marking cart as checked out:', cartErr);
    }

    res.json({ success: true, orderId: order._id });
  } catch (err) {
    console.error('Error in createOrderAfterPayment:', err.stack || err);
    res.status(500).json({ error: err.message });
  }
}; 