// In your payment routes file
const express = require('express');
const router = express.Router();
const paymentController = require('../Controllers/PaymentController');
const { protect } = require('../Middleware/Authentication');

// Use your existing protect middleware
router.post('/create-payment-intent', protect, paymentController.createPaymentIntent);
router.post('/create-order', protect, paymentController.createOrderAfterPayment);

module.exports = router;