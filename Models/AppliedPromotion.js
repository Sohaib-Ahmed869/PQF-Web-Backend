const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Applied Promotion Schema
const AppliedPromotionSchema = new Schema({
  // Reference to the promotion
  promotion: {
    type: Schema.Types.ObjectId,
    ref: 'Promotion',
    required: true
  },
  
  // Reference to the order
  order: {
    type: Schema.Types.ObjectId,
    ref: 'SalesOrder',
    required: true
  },
  
  // Reference to the user
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Store reference
  store: {
    type: Schema.Types.ObjectId,
    ref: 'Store',
    required: true
  },
  
  // Promotion code used (if any)
  code: {
    type: String,
    trim: true,
    uppercase: true
  },
  
  // Type of promotion applied
  type: {
    type: String,
    enum: ['buyXGetY', 'quantityDiscount', 'cartTotal'],
    required: true
  },
  
  // Details of the applied promotion
  appliedDiscounts: [{
    type: {
      type: String,
      enum: ['buyXGetY', 'quantityDiscount', 'cartTotal'],
      required: true
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Item'
    },
    originalQuantity: Number,
    freeQuantity: Number,
    discountAmount: {
      type: Number,
      required: true,
      min: 0
    },
    discountPercentage: Number,
    cartTotal: Number,
    freeItem: {
      type: Schema.Types.ObjectId,
      ref: 'Item'
    },
    freeShipping: Boolean
  }],
  
  // Total discount amount
  totalDiscountAmount: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Original cart total before promotion
  originalCartTotal: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Final cart total after promotion
  finalCartTotal: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Status of the applied promotion
  status: {
    type: String,
    enum: ['applied', 'cancelled', 'refunded'],
    default: 'applied'
  },
  
  // Metadata
  appliedAt: {
    type: Date,
    default: Date.now
  },
  
  // Notes or comments
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Indexes for performance
AppliedPromotionSchema.index({ order: 1 });
AppliedPromotionSchema.index({ user: 1 });
AppliedPromotionSchema.index({ promotion: 1 });
AppliedPromotionSchema.index({ store: 1 });
AppliedPromotionSchema.index({ appliedAt: 1 });

// Virtual for discount percentage
AppliedPromotionSchema.virtual('discountPercentage').get(function() {
  if (this.originalCartTotal === 0) return 0;
  return (this.totalDiscountAmount / this.originalCartTotal) * 100;
});

// Static method to find applied promotions for an order
AppliedPromotionSchema.statics.findByOrder = function(orderId) {
  return this.find({ order: orderId }).populate('promotion');
};

// Static method to find applied promotions for a user
AppliedPromotionSchema.statics.findByUser = function(userId, limit = 10) {
  return this.find({ user: userId })
    .populate('promotion')
    .populate('order')
    .sort({ appliedAt: -1 })
    .limit(limit);
};

// Static method to get promotion usage statistics
AppliedPromotionSchema.statics.getUsageStats = function(promotionId) {
  return this.aggregate([
    { $match: { promotion: new mongoose.Types.ObjectId(promotionId) } },
    {
      $group: {
        _id: null,
        totalUsage: { $sum: 1 },
        totalDiscountAmount: { $sum: '$totalDiscountAmount' },
        averageDiscount: { $avg: '$totalDiscountAmount' }
      }
    }
  ]);
};

module.exports = mongoose.model('AppliedPromotion', AppliedPromotionSchema); 