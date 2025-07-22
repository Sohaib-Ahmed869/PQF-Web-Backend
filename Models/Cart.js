const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema({
  product: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Item', 
    required: true 
  },
  quantity: { 
    type: Number, 
    required: true, 
    min: 1,
    default: 1
  },
  price: { 
    type: Number, 
    required: true,
    min: 0
  }, // Snapshot price at time of adding to cart
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const CartSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  // Store reference
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: false },
  items: [CartItemSchema],
  status: {
    type: String,
    enum: ['active', 'abandoned', 'checked_out', 'expired'],
    default: 'active',
    index: true
  },
  sessionId: {
    type: String,
    sparse: true, // For guest carts
    index: true
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Set expiration to 30 days from now
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    },
    index: { expireAfterSeconds: 0 }
  },
  lastUpdated: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  metadata: {
    userAgent: String,
    ipAddress: String,
    source: {
      type: String,
      enum: ['web', 'mobile', 'api'],
      default: 'web'
    }
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
CartSchema.index({ user: 1, status: 1 });
CartSchema.index({ lastUpdated: 1, status: 1 });
CartSchema.index({ sessionId: 1, status: 1 });

// Virtual for total calculation
CartSchema.virtual('total').get(function() {
  return this.items.reduce((sum, item) => {
    return sum + (item.price * item.quantity);
  }, 0);
});

// Virtual for item count
CartSchema.virtual('itemCount').get(function() {
  return this.items.reduce((sum, item) => {
    return sum + item.quantity;
  }, 0);
});

// Pre-save middleware to update lastUpdated
CartSchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

// Static methods
CartSchema.statics.findActiveByUser = function(userId) {
  return this.findOne({ user: userId, status: 'active' });
};

CartSchema.statics.findOrCreateActiveCart = async function(userId) {
  let cart = await this.findActiveByUser(userId);
  if (!cart) {
    cart = await this.create({ user: userId, items: [] });
  }
  return cart;
};

CartSchema.statics.findAbandonedCarts = function(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({
    status: 'active',
    lastUpdated: { $lt: since },
    'items.0': { $exists: true } // Only carts with items
  });
};

// Instance methods
CartSchema.methods.addItem = function(productId, quantity, price) {
  const existingItemIndex = this.items.findIndex(
    item => item.product.toString() === productId.toString()
  );
  
  if (existingItemIndex > -1) {
    this.items[existingItemIndex].quantity += quantity;
    this.items[existingItemIndex].price = price; // Update price
  } else {
    this.items.push({
      product: productId,
      quantity: quantity,
      price: price
    });
  }
  
  this.lastUpdated = new Date();
  return this;
};

CartSchema.methods.removeItem = function(productId) {
  this.items = this.items.filter(
    item => item.product.toString() !== productId.toString()
  );
  this.lastUpdated = new Date();
  return this;
};

CartSchema.methods.updateItemQuantity = function(productId, quantity) {
  const item = this.items.find(
    item => item.product.toString() === productId.toString()
  );
  
  if (item) {
    if (quantity <= 0) {
      return this.removeItem(productId);
    } else {
      item.quantity = quantity;
      this.lastUpdated = new Date();
    }
  }
  
  return this;
};

CartSchema.methods.clearItems = function() {
  this.items = [];
  this.lastUpdated = new Date();
  return this;
};

CartSchema.methods.markAsAbandoned = function() {
  this.status = 'abandoned';
  this.lastUpdated = new Date();
  return this;
};

CartSchema.methods.markAsCheckedOut = function() {
  this.status = 'checked_out';
  this.lastUpdated = new Date();
  return this;
};

// Middleware to populate product details when needed
CartSchema.methods.populateItems = function() {
  return this.populate('items.product');
};

module.exports = mongoose.model('Cart', CartSchema);