const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PaymentSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: 'SalesOrder', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
  paymentIntentId: { type: String }, // Not always required for non-card payments
  chargeId: { type: String }, // Stripe charge ID
  amount: { type: Number, required: true },
  currency: { type: String, default: 'aed' }, // Changed default from 'eur' to 'aed'
  status: { 
    type: String, 
    required: true,
    enum: [
      'paid', 
      'failed', 
      'canceled', 
      'refunded', 
      'pending', 
      'pending_cash',
      'pending_cheque', 
      'pending_bank_transfer',
      'paused', 
      'active',
      'created',
      'deleted',
      'updated',
      'past_due'
    ]
  }, // Payment status
  paymentMethod: { 
    type: String, 
    enum: ['card', 'cash', 'cheque', 'bank_transfer'],
    default: 'card'
  }, // Payment method
  receiptUrl: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  // Store reference
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: false },
  
  // Additional fields for tracking
  failureReason: { type: String }, // For failed payments
  refundAmount: { type: Number }, // For partial refunds
  refundReason: { type: String }, // For refunds
  
  // Metadata for additional info
  metadata: {
    type: Map,
    of: String,
    default: {}
  },
  
  // Transaction details for better history tracking
  transactionDetails: {
    orderType: { type: String, enum: ['one-time', 'recurring'] },
    isRecurring: { type: Boolean, default: false },
    recurringFrequency: { type: String, enum: ['weekly', 'biweekly', 'monthly', 'quarterly'] },
    stripeSubscriptionId: { type: String },
    stripeCustomerId: { type: String }
  }
});

// Update timestamps on save
PaymentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for performance
PaymentSchema.index({ paymentIntentId: 1 });
PaymentSchema.index({ chargeId: 1 });
PaymentSchema.index({ order: 1 });
PaymentSchema.index({ user: 1 });
PaymentSchema.index({ status: 1 });
PaymentSchema.index({ createdAt: -1 });

// Unique index to prevent duplicate payment records for the same order
PaymentSchema.index({ order: 1 }, { unique: true });

module.exports = mongoose.model('PQFPayment', PaymentSchema);