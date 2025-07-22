const express = require('express');
const router = express.Router();
const PaymentController = require('../Controllers/PaymentController');

router.post('/create-payment-intent', PaymentController.createPaymentIntent);
router.post('/create-order', PaymentController.createOrderAfterPayment);

module.exports = router; 