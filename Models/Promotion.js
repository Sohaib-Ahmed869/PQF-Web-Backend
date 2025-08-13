const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Promotion Rule Schema for different promotion types
const PromotionRuleSchema = new Schema({
  // For "Buy X Get Y Free" promotions
  buyXGetY: {
    buyQuantity: { type: Number, min: 1 },
    getQuantity: { type: Number, min: 1 },
    sameItem: { type: Boolean, default: true }, // If true, get same item free
    freeItem: { type: Schema.Types.ObjectId, ref: 'Item' } // If sameItem is false, specify which item
  },
  
  // For "Buy X Quantity Get Discount" promotions
  quantityDiscount: {
    minQuantity: { type: Number, min: 1 },
    discountPercentage: { type: Number, min: 0, max: 100 },
    discountAmount: { type: Number, min: 0 }
  },
  
  // For "Cart Total" promotions
  cartTotal: {
    minAmount: { type: Number, min: 0 },
    discountPercentage: { type: Number, min: 0, max: 100 },
    discountAmount: { type: Number, min: 0 },
    freeItem: { type: Schema.Types.ObjectId, ref: 'Item' },
    freeShipping: { type: Boolean, default: false }
  }
}, { _id: false });

// Promotion Schema
const PromotionSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  code: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true
  },
  type: {
    type: String,
    enum: ['buyXGetY', 'quantityDiscount', 'cartTotal'],
    required: true
  },
  rule: {
    type: PromotionRuleSchema,
    required: true
  },
  
  // Applicable products/categories
  applicableProducts: [{
    type: Schema.Types.ObjectId,
    ref: 'Item'
  }],
  applicableCategories: [{
    type: Schema.Types.ObjectId,
    ref: 'Category'
  }],
  
  // Store reference
  store: {
    type: Schema.Types.ObjectId,
    ref: 'Store',
    required: true
  },
  
  // Promotion validity
  startDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true
  },
  
  // Usage limits
  maxUsage: {
    type: Number,
    min: 0,
    default: 0 // 0 means unlimited
  },
  currentUsage: {
    type: Number,
    default: 0
  },
  
  // Per user limits
  maxUsagePerUser: {
    type: Number,
    min: 0,
    default: 1
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Priority (higher number = higher priority)
  priority: {
    type: Number,
    default: 1
  },
  
  // Auto-application settings
  autoApply: {
    type: Boolean,
    default: false
  },
  requiresCode: {
    type: Boolean,
    default: true
  },
  
  // Minimum order requirements
  minOrderAmount: {
    type: Number,
    min: 0,
    default: 0
  },
  
  // Excluded products/categories
  excludedProducts: [{
    type: Schema.Types.ObjectId,
    ref: 'Item'
  }],
  excludedCategories: [{
    type: Schema.Types.ObjectId,
    ref: 'Category'
  }],
  
  // Metadata
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Tracking
  usageHistory: [{
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    order: { type: Schema.Types.ObjectId, ref: 'SalesOrder' },
    usedAt: { type: Date, default: Date.now },
    discountAmount: { type: Number, default: 0 }
  }]
}, {
  timestamps: true
});

// Indexes for performance
PromotionSchema.index({ store: 1, isActive: 1, startDate: 1, endDate: 1 });
PromotionSchema.index({ code: 1 });
PromotionSchema.index({ 'usageHistory.user': 1 });

// Virtual for checking if promotion is currently valid
PromotionSchema.virtual('isValid').get(function() {
  const now = new Date();
  const isValid = this.isActive && 
         this.startDate <= now && 
         this.endDate >= now &&
         (this.maxUsage === 0 || this.currentUsage < this.maxUsage);
  
  console.log('Promotion validity:', { id: this._id, isValid });
  
  return isValid;
});

// Method to check validity (fallback for when virtual is not accessible)
PromotionSchema.methods.checkValidity = function() {
  const now = new Date();
  return this.isActive && 
         this.startDate <= now && 
         this.endDate >= now &&
         (this.maxUsage === 0 || this.currentUsage < this.maxUsage);
};

// Method to check if promotion can be applied to a cart
PromotionSchema.methods.canApplyToCart = function(cart, userId) {
  console.log('Checking promotion:', { id: this._id, name: this.name });
  
  // Check validity using virtual property or fallback method
  const isValid = this.isValid !== undefined ? this.isValid : this.checkValidity();
  
  if (!isValid) {
    console.log('Promotion not valid');
    return false;
  }
  
  // Check if user has already used this promotion maximum times
  const userUsageCount = (this.usageHistory || []).filter(
    usage => usage.user && usage.user.toString() === userId.toString()
  ).length;
  
  if (userUsageCount >= this.maxUsagePerUser) {
    console.log('User exceeded usage limit');
    return false;
  }
  
  // Check minimum order amount based on paid items only
  const cartTotal = cart.items.reduce((sum, item) => {
    // If item is free or has free quantity, only charge for the non-free portion
    if (item.isFreeItem) {
      // If the entire item is free, don't add anything to total
      return sum;
    } else if (item.freeQuantity && item.freeQuantity > 0) {
      // If item has free quantity, only charge for the non-free portion
      const chargeableQuantity = item.quantity - item.freeQuantity;
      return sum + (item.price * Math.max(0, chargeableQuantity));
    } else {
      // Regular item, charge full price
      return sum + (item.price * item.quantity);
    }
  }, 0);
  
  if (cartTotal < this.minOrderAmount) {
    console.log('Cart total below minimum:', cartTotal, '<', this.minOrderAmount);
    return false;
  }
  
  console.log('Promotion can be applied');
  return true;
};

// Method to apply promotion to cart
PromotionSchema.methods.applyToCart = function(cart) {
  const appliedDiscounts = [];
  
  console.log('Applying promotion:', { id: this._id, name: this.name, type: this.type });
  
  // Validate that rule exists and has the required structure
  if (!this.rule) {
    console.log('No rule found');
    return appliedDiscounts;
  }
  
  // Validate that cart has items
  if (!cart.items || cart.items.length === 0) {
    console.log('Cart has no items');
    return appliedDiscounts;
  }
  
  // Validate that cart items have the required structure
  const validItems = cart.items.filter(item => {
    if (!item.product || !item.product._id) {
      console.log('Invalid cart item:', item);
      return false;
    }
    return true;
  });
  
  if (validItems.length === 0) {
    console.log('No valid items in cart');
    return appliedDiscounts;
  }
  
  switch (this.type) {
    case 'buyXGetY':
      console.log('Processing buyXGetY');
      if (this.rule.buyXGetY) {
        appliedDiscounts.push(...this.applyBuyXGetY(cart));
      } else {
        console.log('buyXGetY rule not found');
      }
      break;
    case 'quantityDiscount':
      console.log('Processing quantityDiscount');
      if (this.rule.quantityDiscount) {
        appliedDiscounts.push(...this.applyQuantityDiscount(cart));
      } else {
        console.log('quantityDiscount rule not found');
      }
      break;
    case 'cartTotal':
      console.log('Processing cartTotal');
      if (this.rule.cartTotal) {
        appliedDiscounts.push(...this.applyCartTotalDiscount(cart));
      } else {
        console.log('cartTotal rule not found');
      }
      break;
    default:
      console.log('Unknown promotion type:', this.type);
  }
  
  console.log('Applied discounts:', appliedDiscounts.length);
  return appliedDiscounts;
};

// Enhanced applyBuyXGetY method with better validation
PromotionSchema.methods.applyBuyXGetY = function(cart) {
  const discounts = [];
  
  // Validate rule structure
  if (!this.rule || !this.rule.buyXGetY) {
    console.log('buyXGetY rule not found');
    return discounts;
  }
  
  const { buyQuantity, getQuantity, sameItem, freeItem } = this.rule.buyXGetY;
  
  console.log('Applying buy X get Y discount:', {
    buyQuantity,
    getQuantity,
    sameItem,
    freeItem
  });
  
  // Validate required fields
  if (!buyQuantity || buyQuantity <= 0 || !getQuantity || getQuantity <= 0) {
    console.log('Invalid buyQuantity or getQuantity for buyXGetY promotion');
    return discounts;
  }
  
  for (const cartItem of cart.items) {
    const product = cartItem.product;
    
    console.log('Checking product for buy X get Y:', {
      productId: product._id,
      productName: product.ItemName || product.name,
      quantity: cartItem.quantity,
      price: cartItem.price
    });
    
    // Check if product is applicable
    if (!this.isProductApplicable(product)) {
      console.log('Product not applicable for buy X get Y:', product._id);
      continue;
    }
    
    // For buyXGetY, we typically give the same item free unless specified otherwise
    let isEligibleItem = true;
    
    if (!sameItem && freeItem) {
      // If it's not the same item and a specific free item is defined,
      // this logic would need to be handled differently
      isEligibleItem = product._id.toString() === freeItem.toString();
    }
    
    if (!isEligibleItem) {
      console.log('Product not eligible for buy X get Y:', product._id);
      continue;
    }
    
    // Calculate based on PAID quantity only (exclude free items from previous promotions)
    let paidQuantity = cartItem.quantity;
    
    // If item has free quantity, subtract it to get only the paid quantity
    if (cartItem.freeQuantity && cartItem.freeQuantity > 0) {
      paidQuantity = cartItem.quantity - cartItem.freeQuantity;
    }
    
    // If this is entirely a free item, skip it
    if (cartItem.isFreeItem || paidQuantity <= 0) {
      console.log('Skipping free item or item with no paid quantity:', product._id);
      continue;
    }
    
    // Calculate how many free items the user gets based on PAID quantity only
    const sets = Math.floor(paidQuantity / buyQuantity);
    const freeItemsCount = sets * getQuantity;
    
    console.log('Calculated free items:', {
      productId: product._id,
      totalQuantity: cartItem.quantity,
      paidQuantity: paidQuantity,
      existingFreeQuantity: cartItem.freeQuantity || 0,
      buyQuantity,
      getQuantity,
      sets,
      freeItemsCount
    });
    
    if (freeItemsCount > 0) {
      console.log('Adding discount for product:', product._id, 'with', freeItemsCount, 'free items');
      discounts.push({
        type: 'buyXGetY',
        productId: product._id,
        originalQuantity: cartItem.quantity,
        freeQuantity: freeItemsCount,
        discountAmount: 0 // Set to 0 because discount is already applied through freeQuantity
      });
    } else {
      console.log('No free items for product:', product._id, 'quantity:', cartItem.quantity, 'buyQuantity:', buyQuantity);
    }
  }
  
  console.log('Total buyXGetY discounts calculated:', discounts.length);
  return discounts;
};

// Enhanced applyQuantityDiscount method
PromotionSchema.methods.applyQuantityDiscount = function(cart) {
  console.log('Applying quantityDiscount promotion');
  
  if (!this.rule || !this.rule.quantityDiscount) {
    console.log('quantityDiscount rule not found');
    return [];
  }
  
  const { minQuantity, discountPercentage, discountAmount } = this.rule.quantityDiscount;
  
  console.log('QuantityDiscount parameters:', {
    minQuantity,
    discountPercentage,
    discountAmount
  });
  
  if (!minQuantity || minQuantity <= 0) {
    console.log('Invalid minQuantity for quantityDiscount promotion');
    return [];
  }
  
  // Check if either discountPercentage or discountAmount is provided
  if ((!discountPercentage || discountPercentage <= 0) && (!discountAmount || discountAmount <= 0)) {
    console.log('Neither discountPercentage nor discountAmount specified or both are zero/negative');
    return [];
  }
  
  const appliedDiscounts = [];
  
  // Get applicable cart items
  const applicableItems = cart.items.filter(item => this.isProductApplicable(item.product));
  
  if (applicableItems.length === 0) {
    console.log('No applicable items found for quantityDiscount promotion');
    return [];
  }
  
  // Calculate total PAID quantity of applicable items (exclude free items)
  const totalQuantity = applicableItems.reduce((sum, item) => {
    // Skip entirely free items
    if (item.isFreeItem) {
      return sum;
    }
    
    // Calculate paid quantity only
    let paidQuantity = item.quantity;
    if (item.freeQuantity && item.freeQuantity > 0) {
      paidQuantity = item.quantity - item.freeQuantity;
    }
    
    return sum + Math.max(0, paidQuantity);
  }, 0);
  
  console.log('Total quantity of applicable items:', totalQuantity);
  
  if (totalQuantity < minQuantity) {
    console.log(`Total quantity (${totalQuantity}) is less than minimum required (${minQuantity})`);
    return [];
  }
  
  // Calculate discount
  let discount = 0;
  
  if (discountAmount && discountAmount > 0) {
    // Fixed amount discount
    discount = discountAmount;
    console.log('Applying fixed amount discount:', discount);
  } else if (discountPercentage && discountPercentage > 0) {
    // Percentage discount - calculate based on PAID items total only
    const applicableItemsTotal = applicableItems.reduce((sum, item) => {
      // Skip entirely free items
      if (item.isFreeItem) {
        return sum;
      }
      
      // Calculate paid quantity only
      let paidQuantity = item.quantity;
      if (item.freeQuantity && item.freeQuantity > 0) {
        paidQuantity = item.quantity - item.freeQuantity;
      }
      
      return sum + (item.price * Math.max(0, paidQuantity));
    }, 0);
    discount = applicableItemsTotal * discountPercentage / 100;
    console.log('Applying percentage discount:', discount, 'on total:', applicableItemsTotal);
  }
  
  if (discount > 0) {
    appliedDiscounts.push({
      type: 'quantityDiscount',
      discountAmount: discount,
      description: `Quantity discount: ${discountAmount ? `$${discountAmount}` : `${discountPercentage}%`} off when buying ${minQuantity}+ items`
    });
  }
  
  console.log('Applied quantityDiscount discounts:', appliedDiscounts);
  return appliedDiscounts;
};

// Enhanced applyCartTotalDiscount method
PromotionSchema.methods.applyCartTotalDiscount = function(cart) {
  const discounts = [];
  
  // Validate rule structure
  if (!this.rule || !this.rule.cartTotal) {
    console.log('cartTotal rule not found');
    return discounts;
  }
  
  const { minAmount, discountPercentage, discountAmount, freeItem, freeShipping } = this.rule.cartTotal;
  
  console.log('Applying cart total discount:', {
    minAmount,
    discountPercentage,
    discountAmount,
    freeItem,
    freeShipping
  });
  
  // Validate required fields
  if (minAmount === undefined || minAmount === null || minAmount < 0) {
    console.log('Invalid minAmount for cartTotal promotion');
    return discounts;
  }
  
  // Calculate cart total for applicable products only
  let applicableCartTotal = 0;
  const applicableItems = [];
  
  for (const cartItem of cart.items) {
    const product = cartItem.product;
    
    if (this.isProductApplicable(product)) {
      // Calculate based on PAID quantity only (exclude free items)
      if (!cartItem.isFreeItem) {
        let paidQuantity = cartItem.quantity;
        if (cartItem.freeQuantity && cartItem.freeQuantity > 0) {
          paidQuantity = cartItem.quantity - cartItem.freeQuantity;
        }
        
        applicableCartTotal += cartItem.price * Math.max(0, paidQuantity);
        applicableItems.push(cartItem);
      }
    }
  }
  
  console.log('Cart total calculation:', {
    totalCartValue: cart.items.reduce((sum, item) => {
      // If item is free or has free quantity, only charge for the non-free portion
      if (item.isFreeItem) {
        // If the entire item is free, don't add anything to total
        return sum;
      } else if (item.freeQuantity && item.freeQuantity > 0) {
        // If item has free quantity, only charge for the non-free portion
        const chargeableQuantity = item.quantity - item.freeQuantity;
        return sum + (item.price * Math.max(0, chargeableQuantity));
      } else {
        // Regular item, charge full price
        return sum + (item.price * item.quantity);
      }
    }, 0),
    applicableCartTotal: applicableCartTotal,
    minAmount: minAmount,
    applicableItems: applicableItems.length
  });
  
  if (applicableCartTotal >= minAmount) {
    let discount = 0;
    
    if (discountAmount && discountAmount > 0) {
      discount = discountAmount;
    } else if (discountPercentage && discountPercentage > 0) {
      discount = applicableCartTotal * discountPercentage / 100;
    }
    
    console.log('Calculated cart total discount:', discount);
    
    if (discount > 0) {
      discounts.push({
        type: 'cartTotal',
        cartTotal: applicableCartTotal,
        discountAmount: discount,
        freeItem: freeItem,
        freeShipping: freeShipping
      });
    }
    
    // Handle free item if specified
    if (freeItem) {
      // This would need additional logic to add the free item to the cart
      console.log('Free item specified:', freeItem);
    }
    
    // Handle free shipping if specified
    if (freeShipping) {
      console.log('Free shipping applied');
    }
  } else {
    console.log('Cart total below minimum amount:', {
      applicableCartTotal: applicableCartTotal,
      minAmount: minAmount,
      difference: minAmount - applicableCartTotal
    });
  }
  
  console.log('Total cart discounts calculated:', discounts.length);
  return discounts;
};

// Helper method to check if product is applicable - FIXED VERSION
PromotionSchema.methods.isProductApplicable = function(product) {
  if (!product || !product._id) {
    console.log('Product not found or invalid:', product);
    return false;
  }
  
  const applicableProducts = this.applicableProducts || [];
  const applicableCategories = this.applicableCategories || [];
  const excludedProducts = this.excludedProducts || [];
  const excludedCategories = this.excludedCategories || [];
  
  console.log('Checking product applicability:', {
    productId: product._id,
    productName: product.ItemName || product.name,
    productCategory: product.ItemsGroupCode,
    applicableProductsLength: applicableProducts.length,
    applicableCategoriesLength: applicableCategories.length,
    excludedProductsLength: excludedProducts.length,
    excludedCategoriesLength: excludedCategories.length
  });
  
  // Check if product is in excluded list
  if (excludedProducts.length > 0) {
    const isExcluded = excludedProducts.some(p => p.toString() === product._id.toString());
    if (isExcluded) {
      console.log('Product excluded:', product._id);
      return false;
    }
  }
  
  // Check if product's category is excluded
  if (excludedCategories.length > 0 && product.ItemsGroupCode) {
    // For excluded categories, check if any category's ItemsGroupCode matches the product's ItemsGroupCode
    const isCategoryExcluded = excludedCategories.some(cat => {
      // If cat is populated (has ItemsGroupCode), use it directly
      if (cat.ItemsGroupCode !== undefined) {
        return cat.ItemsGroupCode === product.ItemsGroupCode;
      }
      // If cat is just an ObjectId, we need to handle this differently
      return false;
    });
    if (isCategoryExcluded) {
      console.log('Product category excluded:', product.ItemsGroupCode);
      return false;
    }
  }
  
  // If both applicableProducts and applicableCategories are empty, 
  // then all products are applicable (except excluded ones)
  if (applicableProducts.length === 0 && applicableCategories.length === 0) {
    console.log('No restrictions specified, product is applicable:', product._id);
    return true;
  }
  
  // Check if product is in included products list
  if (applicableProducts.length > 0) {
    const isIncluded = applicableProducts.some(p => p.toString() === product._id.toString());
    if (isIncluded) {
      console.log('Product found in applicable products list:', product._id);
      return true;
    }
  }
  
  // Check if product's category is in included categories list
  if (applicableCategories.length > 0 && product.ItemsGroupCode) {
    // For applicable categories, check if any category's ItemsGroupCode matches the product's ItemsGroupCode
    const isCategoryIncluded = applicableCategories.some(cat => {
      // If cat is populated (has ItemsGroupCode), use it directly
      if (cat.ItemsGroupCode !== undefined) {
        return cat.ItemsGroupCode === product.ItemsGroupCode;
      }
      // If cat is just an ObjectId, we need to handle this differently
      return false;
    });
    if (isCategoryIncluded) {
      console.log('Product category found in applicable categories list:', product.ItemsGroupCode);
      return true;
    }
  }
  
  // If we reach here, product doesn't match any inclusion criteria
  console.log('Product not applicable - does not match inclusion criteria:', {
    productId: product._id,
    hasApplicableProducts: applicableProducts.length > 0,
    hasApplicableCategories: applicableCategories.length > 0,
    productInApplicableProducts: applicableProducts.length > 0 ? applicableProducts.some(p => p.toString() === product._id.toString()) : false,
    productCategoryInApplicableCategories: applicableCategories.length > 0 && product.ItemsGroupCode ? applicableCategories.some(cat => cat.ItemsGroupCode !== undefined ? cat.ItemsGroupCode === product.ItemsGroupCode : false) : false
  });
  
  return false;
};

// Static method to find active promotions for a store
PromotionSchema.statics.findActivePromotions = function(storeId) {
  const now = new Date();
  return this.find({
    store: storeId,
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now }
  }).sort({ priority: -1 });
};

// Static method to find applicable promotions for a cart
PromotionSchema.statics.findApplicablePromotions = function(cart, storeId, userId) {
  return this.findActivePromotions(storeId).then(promotions => {
    return promotions.filter(promotion => promotion.canApplyToCart(cart, userId));
  });
};

// Static method to find auto-applicable promotions for a cart
PromotionSchema.statics.findAutoApplicablePromotions = function(cart, storeId, userId) {
  const now = new Date();
  return this.find({
    store: storeId,
    isActive: true,
    autoApply: true,
    requiresCode: false,
    startDate: { $lte: now },
    endDate: { $gte: now },
    type: { $in: ['buyXGetY', 'quantityDiscount'] } // Only auto-apply product-level promotions
  })
  .populate([
    { path: 'applicableProducts', select: 'ItemName _id' },
    { path: 'applicableCategories', select: 'name _id ItemsGroupCode' },
    { path: 'excludedProducts', select: 'ItemName _id' },
    { path: 'excludedCategories', select: 'name _id ItemsGroupCode' }
  ])
  .sort({ priority: -1 })
  .then(promotions => {
    return promotions.filter(promotion => promotion.canApplyToCart(cart, userId));
  });
};

module.exports = mongoose.model('Promotion', PromotionSchema); 