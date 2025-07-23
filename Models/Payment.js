const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PaymentSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: 'SalesOrder', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
  paymentIntentId: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'eur' },
  status: { type: String, required: true }, // e.g., 'succeeded'
  paymentMethod: { type: String }, // e.g., 'stripe'
  receiptUrl: { type: String },
  createdAt: { type: Date, default: Date.now },
  // Store reference
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: false },
  // Optionally add card details, etc.
});

module.exports = mongoose.model('PQFPayment', PaymentSchema); 