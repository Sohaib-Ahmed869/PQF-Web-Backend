const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema({
  disputeId: {
    type: String,
    required: true,
    unique: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesOrder',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  disputeCategory: {
    type: String,
    required: true,
    enum: [
      'product_quality',
      'shipping_delay',
      'wrong_item',
      'damaged_item',
      'not_received',
      'billing_issue',
      'refund_request',
      'other'
    ]
  },
  description: {
    type: String,
    required: true,
    minlength: 10
  },
  disputeStatus: {
    type: String,
    required: true,
    enum: ['open', 'in_progress', 'resolved', 'closed', 'rejected'],
    default: 'open'
  },
  responses: [{
    id: String,
    senderType: {
      type: String,
      enum: ['customer', 'admin'],
      required: true
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    senderName: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  totalResponses: {
    type: Number,
    default: 0
  },
  waitingFor: {
    type: String,
    enum: ['customer', 'admin'],
    default: 'admin'
  },
  hasUnreadAdminResponse: {
    type: Boolean,
    default: false
  },
  needsAdminResponse: {
    type: Boolean,
    default: true
  },
  lastResponseAt: {
    type: Date
  },
  resolvedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Generate dispute ID
disputeSchema.pre('save', function(next) {
  if (this.isNew && !this.disputeId) {
    this.disputeId = 'DSP' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
  }
  next();
});

// Update totalResponses when responses array changes
disputeSchema.pre('save', function(next) {
  this.totalResponses = this.responses.length;
  if (this.responses.length > 0) {
    this.lastResponseAt = this.responses[this.responses.length - 1].timestamp;
  }
  next();
});

// Update waitingFor based on last response
disputeSchema.pre('save', function(next) {
  if (this.responses.length > 0) {
    const lastResponse = this.responses[this.responses.length - 1];
    this.waitingFor = lastResponse.senderType === 'customer' ? 'admin' : 'customer';
  }
  next();
});

module.exports = mongoose.model('Dispute', disputeSchema);