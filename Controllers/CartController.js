const Cart = require('../Models/Cart');
const Item = require('../Models/Product');
const Promotion = require('../Models/Promotion');
const AppliedPromotion = require('../Models/AppliedPromotion');
const mongoose = require('mongoose');

// Helper: Find or create active cart for user
async function getOrCreateActiveCart(userId, storeId) {
  try {
    let query = { user: userId, status: 'active' };
    if (storeId) query.store = storeId;
    let cart = await Cart.findOne(query)
      .populate('items.product');
    
    if (!cart) {
      cart = await Cart.create({ 
        user: userId, 
        store: storeId || undefined,
        items: [],
        status: 'active'
      });
      await cart.populate([
        'items.product',
        {
          path: 'appliedPromotions.promotion',
          select: 'name description type code'
        }
      ]);
    }
    return cart;
  } catch (error) {
    console.error('Error getting or creating cart:', error);
    throw error;
  }
}

// Helper: Get product price
function getProductPrice(product, priceListId = 2) {
  if (!product) return 0;
  
  // Check ItemPrices array
  if (product.ItemPrices && Array.isArray(product.ItemPrices)) {
    const priceItem = product.ItemPrices.find(p => p.PriceList === priceListId);
    if (priceItem) return priceItem.Price;
  }
  
  // Check prices array
  if (product.prices && Array.isArray(product.prices)) {
    const priceItem = product.prices.find(p => p.PriceList === priceListId);
    if (priceItem) return priceItem.Price;
  }
  
  // Fallback to direct price field
  if (product.price) {
    if (typeof product.price === 'string') {
      const priceNum = parseFloat(product.price.replace(/[^0-9.]/g, ''));
      return isNaN(priceNum) ? 0 : priceNum;
    }
    return product.price;
  }
  
  return 0;
}

// Helper: Calculate cart totals with promotions
async function calculateCartTotals(cart, appliedPromotions = []) {
  const originalTotal = cart.items.reduce((sum, item) => {
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

  let totalDiscount = 0;
  const appliedDiscounts = [];

  // Apply promotions if any
  if (appliedPromotions.length > 0) {
    for (const promotion of appliedPromotions) {
      const discounts = promotion.applyToCart(cart);
      appliedDiscounts.push(...discounts);
      totalDiscount += discounts.reduce((sum, discount) => sum + discount.discountAmount, 0);
    }
  }

  const finalTotal = Math.max(0, originalTotal - totalDiscount);

  return {
    originalTotal,
    finalTotal,
    totalDiscount,
    appliedDiscounts
  };
}

// Helper: Get applicable promotions for cart
async function getApplicablePromotionsForCart(cart, storeId, userId) {
  try {
    const promotions = await Promotion.findActivePromotions(storeId);
    return promotions.filter(promotion => promotion.canApplyToCart(cart, userId));
  } catch (error) {
    console.error('Error getting applicable promotions:', error);
    return [];
  }
}

// Helper: Auto-apply eligible promotions to cart
async function autoApplyPromotions(cart, storeId, userId) {
  try {
    console.log('Auto-applying promotions for cart:', cart._id);
    
    if (!storeId) {
      console.log('No store ID provided, skipping auto-promotion application');
      return cart;
    }

    // Get auto-applicable promotions
    const autoPromotions = await Promotion.findAutoApplicablePromotions(cart, storeId, userId);
    console.log('Found auto-applicable promotions:', autoPromotions.length);

    // Store manual promotions separately and validate them
    const manualPromotions = cart.appliedPromotions.filter(ap => !ap.isAutoApplied);
    const validManualPromotions = [];
    const invalidManualPromotions = [];

    // Validate each manual promotion to see if it's still applicable
    for (const manualPromo of manualPromotions) {
      try {
        const promotion = await Promotion.findById(manualPromo.promotion);
        if (promotion && promotion.canApplyToCart(cart, userId)) {
          // Check if the promotion still has applicable discounts
          const testDiscounts = promotion.applyToCart(cart);
          if (testDiscounts.length > 0) {
            validManualPromotions.push(manualPromo);
            console.log('Manual promotion still valid:', promotion.code);
          } else {
            invalidManualPromotions.push(manualPromo);
            console.log('Manual promotion no longer has applicable discounts:', promotion.code);
          }
        } else {
          invalidManualPromotions.push(manualPromo);
          console.log('Manual promotion no longer valid:', promotion ? promotion.code : manualPromo.code);
        }
      } catch (error) {
        console.error('Error validating manual promotion:', error);
        invalidManualPromotions.push(manualPromo);
      }
    }

    // Clean up usage tracking for invalid manual promotions
    for (const invalidPromo of invalidManualPromotions) {
      try {
        const promotion = await Promotion.findById(invalidPromo.promotion);
        if (promotion) {
          console.log('Cleaning up usage tracking for invalid manual promotion:', promotion.code);
          
          // Decrement currentUsage if it was incremented (though it shouldn't be for cart-level)
          if (promotion.currentUsage > 0) {
            promotion.currentUsage -= 1;
          }
          
          // Remove the usage history entry for this user that doesn't have an order reference
          const userUsageIndex = promotion.usageHistory.findIndex(
            usage => usage.user && usage.user.toString() === userId.toString() && !usage.order
          );
          
          if (userUsageIndex !== -1) {
            promotion.usageHistory.splice(userUsageIndex, 1);
            console.log('Removed usage history entry for invalid manual promotion:', promotion._id);
          }
          
          await promotion.save();
        }

        // Remove applied promotion records
        await AppliedPromotion.deleteMany({
          promotion: invalidPromo.promotion,
          user: userId,
          order: null // Only remove if no order is associated (cart-level application)
        });
        console.log('Removed AppliedPromotion records for invalid promotion:', invalidPromo.promotion);
        
      } catch (cleanupError) {
        console.error('Error cleaning up invalid manual promotion:', cleanupError);
      }
    }

    // Remove only auto-applied promotions and invalid manual promotions
    cart.appliedPromotions = validManualPromotions;

    // Reset free items and quantities from ALL previous applications (both auto and invalid manual)
    cart.items = cart.items.filter(item => !item.isFreeItem);
    
    // Handle items with free quantities - remove if quantity becomes 0 or less
    cart.items = cart.items.filter(item => {
      if (item.freeQuantity && item.freeQuantity > 0) {
        const newQuantity = item.quantity - item.freeQuantity;
        if (newQuantity <= 0) {
          // Remove item entirely if no paid quantity remains
          return false;
        } else {
          // Update quantity and reset free quantity
          item.quantity = newQuantity;
          item.freeQuantity = 0;
          return true;
        }
      }
      return true;
    });

    // Apply each auto-promotion that meets criteria
    for (const promotion of autoPromotions) {
      console.log('Checking auto-promotion:', promotion.name, promotion.type);
      
      // Check if promotion still meets criteria (revalidate)
      if (!promotion.canApplyToCart(cart, userId)) {
        console.log('Promotion no longer meets criteria:', promotion.name);
        continue;
      }

      // Apply the promotion
      const appliedDiscounts = promotion.applyToCart(cart);
      
      if (appliedDiscounts.length > 0) {
        console.log('Auto-applying promotion:', promotion.name, 'with', appliedDiscounts.length, 'discounts');
        
        // Calculate total discount amount
        const totalDiscountAmount = appliedDiscounts.reduce((sum, discount) => sum + (discount.discountAmount || 0), 0);

        // Handle buyXGetY promotions - add free items to cart
        if (promotion.type === 'buyXGetY') {
          for (const discount of appliedDiscounts) {
            if (discount.type === 'buyXGetY' && discount.freeQuantity > 0) {
              const productId = discount.productId;
              const freeQuantity = discount.freeQuantity;

              // Find the product in cart
              const existingItemIndex = cart.items.findIndex(
                item => item.product && item.product._id && item.product._id.toString() === productId.toString()
              );

              if (existingItemIndex > -1) {
                // Add free quantity to existing item
                const existingItem = cart.items[existingItemIndex];
                existingItem.quantity += freeQuantity;
                
                if (!existingItem.freeQuantity) {
                  existingItem.freeQuantity = 0;
                }
                existingItem.freeQuantity += freeQuantity;

                console.log(`Added ${freeQuantity} free items to cart item. Total: ${existingItem.quantity}, Free: ${existingItem.freeQuantity}`);
              } else {
                // This shouldn't happen for buyXGetY of same item, but handle it
                const Item = require('../Models/Product');
                const product = await Item.findById(productId);
                if (product) {
                  cart.items.push({
                    product: new mongoose.Types.ObjectId(productId),
                    quantity: freeQuantity,
                    price: getProductPrice(product),
                    isFreeItem: true,
                    freeQuantity: freeQuantity
                  });
                }
              }
            }
          }
        }

        // Track applied promotion in cart (DON'T increment usage yet - only on order placement)
        cart.appliedPromotions.push({
          promotion: promotion._id,
          appliedAt: new Date(),
          discountAmount: totalDiscountAmount,
          code: promotion.code,
          isAutoApplied: true
        });

        console.log('Successfully auto-applied promotion:', promotion.name);
      } else {
        console.log('No discounts applicable for promotion:', promotion.name);
      }
    }

    console.log('Auto-apply complete. Applied promotions:', cart.appliedPromotions.length);
    return cart;
  } catch (error) {
    console.error('Error auto-applying promotions:', error);
    return cart;
  }
}

module.exports = {
  // Get current user's cart with promotions
  async getCart(req, res) {
    try {
      let cart = await getOrCreateActiveCart(req.user._id);
      
      // Auto-apply eligible promotions before displaying
      cart = await autoApplyPromotions(cart, cart.store, req.user._id);
      await cart.save();
      
      // Ensure cart is populated
      await cart.populate([
        'items.product',
        {
          path: 'appliedPromotions.promotion',
          select: 'name description type code'
        }
      ]);
      
      console.log('Cart:', { id: cart._id, items: cart.items.length, store: cart.store });
      
      // Get applicable promotions for display only (don't auto-apply)
      const applicablePromotions = await getApplicablePromotionsForCart(cart, cart.store, req.user._id);
      
      // Get ALL applied promotions from cart.appliedPromotions (both manual and auto)
      const allAppliedPromotions = [];
      if (cart.appliedPromotions && cart.appliedPromotions.length > 0) {
        for (const appliedPromo of cart.appliedPromotions) {
          const promotion = await Promotion.findById(appliedPromo.promotion);
          if (promotion) {
            allAppliedPromotions.push(promotion);
          }
        }
      }
      
      // Calculate totals with ALL applied promotions (manual + auto)
      const totals = await calculateCartTotals(cart, allAppliedPromotions);
      
      const cartData = {
        ...cart.toObject(),
        ...totals,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
        applicablePromotions: applicablePromotions.map(p => ({
          id: p._id,
          name: p.name,
          description: p.description,
          type: p.type,
          code: p.code
        }))
      };
      
      res.json({ success: true, data: cartData });
    } catch (err) {
      console.error('Error getting cart:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Add or update item in cart
  async addItem(req, res) {
    try {
      const { productId, quantity = 1, store } = req.body;
      
      if (!productId) {
        return res.status(400).json({ success: false, error: 'Product ID is required' });
      }
      
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, error: 'Invalid product ID' });
      }
      
      console.log('Adding item to cart:', { productId, quantity, userId: req.user._id });
      
      // Find product
      const product = await Item.findById(productId);
      if (!product) {
        return res.status(404).json({ success: false, error: 'Product not found' });
      }
      
      // Get cart
      let cart = await getOrCreateActiveCart(req.user._id, store);
      
      // Get current price
      const price = getProductPrice(product);
      
      // Check if item already exists in cart
      const existingItemIndex = cart.items.findIndex(
        item => item.product && item.product._id && item.product._id.toString() === productId
      );
      
      if (existingItemIndex > -1) {
        // Update existing item
        cart.items[existingItemIndex].quantity += parseInt(quantity);
        cart.items[existingItemIndex].price = price; // Update price in case it changed
      } else {
        // Add new item
        cart.items.push({
          product: new mongoose.Types.ObjectId(productId),
          quantity: parseInt(quantity),
          price: price
        });
      }
      
      if (store) cart.store = store;
      cart.lastUpdated = new Date();
      
      // Auto-apply eligible promotions before saving
      cart = await autoApplyPromotions(cart, cart.store, req.user._id);
      
      await cart.save();
      
      // Populate and return updated cart
      await cart.populate([
        'items.product',
        {
          path: 'appliedPromotions.promotion',
          select: 'name description type code'
        }
      ]);
      
      // Get applicable promotions for display only (don't auto-apply)
      const applicablePromotions = await getApplicablePromotionsForCart(cart, cart.store, req.user._id);
      
      // Get ALL applied promotions from cart.appliedPromotions (both manual and auto)
      const allAppliedPromotions = [];
      if (cart.appliedPromotions && cart.appliedPromotions.length > 0) {
        for (const appliedPromo of cart.appliedPromotions) {
          const promotion = await Promotion.findById(appliedPromo.promotion);
          if (promotion) {
            allAppliedPromotions.push(promotion);
          }
        }
      }
      
      // Calculate totals with ALL applied promotions (manual + auto)
      const totals = await calculateCartTotals(cart, allAppliedPromotions);
      
      const cartData = {
        ...cart.toObject(),
        ...totals,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
        applicablePromotions: applicablePromotions.map(p => ({
          id: p._id,
          name: p.name,
          description: p.description,
          type: p.type,
          code: p.code
        }))
      };
      
      res.json({ success: true, data: cartData });
    } catch (err) {
      console.error('Error adding item to cart:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Remove item from cart
  async removeItem(req, res) {
    try {
      const { productId, store } = req.body;
      
      if (!productId) {
        return res.status(400).json({ success: false, error: 'Product ID is required' });
      }
      
      let cart = await getOrCreateActiveCart(req.user._id, store);
      
      // Remove item
      cart.items = cart.items.filter(
        item => item.product && item.product._id && item.product._id.toString() !== productId
      );
      
      cart.lastUpdated = new Date();
      
      // Auto-apply eligible promotions before saving
      cart = await autoApplyPromotions(cart, cart.store, req.user._id);
      
      await cart.save();
      await cart.populate([
        'items.product',
        {
          path: 'appliedPromotions.promotion',
          select: 'name description type code'
        }
      ]);
      
      // Get applicable promotions for display only (don't auto-apply)
      const applicablePromotions = await getApplicablePromotionsForCart(cart, cart.store, req.user._id);
      
      // Get ALL applied promotions from cart.appliedPromotions (both manual and auto)
      const allAppliedPromotions = [];
      if (cart.appliedPromotions && cart.appliedPromotions.length > 0) {
        for (const appliedPromo of cart.appliedPromotions) {
          const promotion = await Promotion.findById(appliedPromo.promotion);
          if (promotion) {
            allAppliedPromotions.push(promotion);
          }
        }
      }
      
      // Calculate totals with ALL applied promotions (manual + auto)
      const totals = await calculateCartTotals(cart, allAppliedPromotions);
      
      const cartData = {
        ...cart.toObject(),
        ...totals,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
        applicablePromotions: applicablePromotions.map(p => ({
          id: p._id,
          name: p.name,
          description: p.description,
          type: p.type,
          code: p.code
        }))
      };
      
      res.json({ success: true, data: cartData });
    } catch (err) {
      console.error('Error removing item from cart:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Update item quantity
  // NOTE: The 'quantity' parameter represents the desired PAID quantity (excluding free items)
  // The backend will recalculate and add any applicable free quantities via autoApplyPromotions
  async updateItem(req, res) {
    try {
      const { productId, quantity, store } = req.body;
      
      if (!productId || quantity === undefined) {
        return res.status(400).json({ 
          success: false, 
          error: 'Product ID and quantity are required' 
        });
      }
      
      if (parseInt(quantity) < 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Quantity must be 0 or greater' 
        });
      }
      
      let cart = await getOrCreateActiveCart(req.user._id, store);
      
      // Find and update item
      const itemIndex = cart.items.findIndex(
        item => item.product && item.product._id && item.product._id.toString() === productId
      );
      
      if (itemIndex === -1) {
        return res.status(404).json({ 
          success: false, 
          error: 'Item not found in cart' 
        });
      }
      
      if (parseInt(quantity) === 0) {
        // Remove item if quantity is 0
        cart.items.splice(itemIndex, 1);
      } else {
        // Update PAID quantity only - reset free quantities first, then set new paid quantity
        // The quantity parameter now represents the desired PAID quantity (not total)
        const cartItem = cart.items[itemIndex];
        
        // Reset any existing free quantities
        cartItem.freeQuantity = 0;
        cartItem.isFreeItem = false;
        
        // Set the new paid quantity
        cartItem.quantity = parseInt(quantity);
      }
      
      cart.lastUpdated = new Date();
      
      // Auto-apply eligible promotions before saving
      cart = await autoApplyPromotions(cart, cart.store, req.user._id);
      
      await cart.save();
      await cart.populate([
        'items.product',
        {
          path: 'appliedPromotions.promotion',
          select: 'name description type code'
        }
      ]);
      
      // Get applicable promotions for display only (don't auto-apply)
      const applicablePromotions = await getApplicablePromotionsForCart(cart, cart.store, req.user._id);
      
      // Get ALL applied promotions from cart.appliedPromotions (both manual and auto)
      const allAppliedPromotions = [];
      if (cart.appliedPromotions && cart.appliedPromotions.length > 0) {
        for (const appliedPromo of cart.appliedPromotions) {
          const promotion = await Promotion.findById(appliedPromo.promotion);
          if (promotion) {
            allAppliedPromotions.push(promotion);
          }
        }
      }
      
      // Calculate totals with ALL applied promotions (manual + auto)
      const totals = await calculateCartTotals(cart, allAppliedPromotions);
      
      const cartData = {
        ...cart.toObject(),
        ...totals,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
        applicablePromotions: applicablePromotions.map(p => ({
          id: p._id,
          name: p.name,
          description: p.description,
          type: p.type,
          code: p.code
        }))
      };
      
      res.json({ success: true, data: cartData });
    } catch (err) {
      console.error('Error updating item in cart:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Clear cart
  async clearCart(req, res) {
    try {
      const { store } = req.body;
      let cart = await getOrCreateActiveCart(req.user._id, store);
      
      cart.items = [];
      cart.lastUpdated = new Date();
      await cart.save();
      
      const cartData = {
        ...cart.toObject(),
        originalTotal: 0,
        finalTotal: 0,
        totalDiscount: 0,
        appliedDiscounts: [],
        itemCount: 0,
        applicablePromotions: []
      };
      
      res.json({ success: true, data: cartData });
    } catch (err) {
      console.error('Error clearing cart:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Apply promotion to cart - FIXED VERSION
  async applyPromotion(req, res) {
    try {
      const { promotionId, promotionCode } = req.body;
      
      console.log('Applying promotion:', { promotionId, promotionCode, userId: req.user._id });
      
      if (!promotionId && !promotionCode) {
        return res.status(400).json({
          success: false,
          error: 'Either promotion ID or promotion code is required'
        });
      }
      
      let cart = await getOrCreateActiveCart(req.user._id);
      
      // Ensure cart is populated
      await cart.populate([
        'items.product',
        {
          path: 'appliedPromotions.promotion',
          select: 'name description type code'
        }
      ]);
      
      console.log('Cart found:', {
        cartId: cart._id,
        itemsCount: cart.items.length,
        store: cart.store,
        items: cart.items.map(item => ({
          productId: item.product?._id,
          productName: item.product?.ItemName || item.product?.name,
          quantity: item.quantity,
          price: item.price
        }))
      });
      
      // Check if cart has items
      if (!cart.items || cart.items.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Cart is empty. Add items to cart before applying promotion.'
        });
      }
      
      let promotion;
      if (promotionId) {
        promotion = await Promotion.findById(promotionId);
      } else if (promotionCode) {
        // Build query for promotion search
        const query = {
          code: promotionCode.toUpperCase(),
          isActive: true
        };
        
        // Only add store filter if cart has a store
        if (cart.store) {
          query.store = cart.store;
        }
        
        console.log('Searching for promotion with query:', query);
        promotion = await Promotion.findOne(query);
        
        // If not found with store filter, try without store filter
        if (!promotion && cart.store) {
          console.log('Promotion not found with store filter, trying without store filter');
          const queryWithoutStore = {
            code: promotionCode.toUpperCase(),
            isActive: true
          };
          promotion = await Promotion.findOne(queryWithoutStore);
        }
      }
      
      if (!promotion) {
        console.log('Promotion not found:', { promotionCode, store: cart.store });
        
        // Let's check if the promotion exists at all
        const allPromotions = await Promotion.find({ code: promotionCode.toUpperCase() });
        console.log('All promotions with this code:', allPromotions.map(p => ({
          id: p._id,
          name: p.name,
          code: p.code,
          store: p.store,
          isActive: p.isActive
        })));
        
        return res.status(404).json({
          success: false,
          error: 'Promotion not found'
        });
      }
      
      // Ensure virtual properties are available - populate only necessary fields
      await promotion.populate([
        { path: 'applicableProducts', select: 'ItemName _id' },
        { path: 'applicableCategories', select: 'name _id ItemsGroupCode' },
        { path: 'excludedProducts', select: 'ItemName _id' },
        { path: 'excludedCategories', select: 'name _id ItemsGroupCode' }
      ]);
      
      console.log('Promotion found:', {
        id: promotion._id,
        name: promotion.name,
        type: promotion.type,
        code: promotion.code,
        isValid: promotion.isValid,
        minOrderAmount: promotion.minOrderAmount,
        maxUsagePerUser: promotion.maxUsagePerUser,
        store: promotion.store,
        applicableProducts: promotion.applicableProducts?.map(p => ({ id: p._id, name: p.ItemName })) || [],
        applicableCategories: promotion.applicableCategories?.map(c => ({ id: c._id, name: c.name })) || [],
        excludedProducts: promotion.excludedProducts?.map(p => ({ id: p._id, name: p.ItemName })) || [],
        excludedCategories: promotion.excludedCategories?.map(c => ({ id: c._id, name: c.name })) || [],
        rule: promotion.rule
      });
      
      // Check if this promotion is already applied to the cart
      const existingPromotionIndex = cart.appliedPromotions.findIndex(
        ap => ap.promotion && ap.promotion.toString() === promotion._id.toString()
      );
      
      if (existingPromotionIndex !== -1) {
        return res.status(400).json({
          success: false,
          error: 'This promotion has already been applied to your cart'
        });
      }
      
      // Check if promotion can be applied - WITH DETAILED LOGGING
      if (!promotion.canApplyToCart(cart, req.user._id)) {
        console.log('Promotion cannot be applied to cart - checking reasons:');
        
        // Manual checks for debugging
        const now = new Date();
        const isValid = promotion.isActive && 
               promotion.startDate <= now && 
               promotion.endDate >= now &&
               (promotion.maxUsage === 0 || promotion.currentUsage < promotion.maxUsage);
        
        const userUsageCount = (promotion.usageHistory || []).filter(
          usage => usage.user && usage.user.toString() === req.user._id.toString()
        ).length;
        
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
        
        console.log('Promotion validation details:', {
          isActive: promotion.isActive,
          startDate: promotion.startDate,
          endDate: promotion.endDate,
          now: now,
          maxUsage: promotion.maxUsage,
          currentUsage: promotion.currentUsage,
          isValid: isValid,
          userUsageCount: userUsageCount,
          maxUsagePerUser: promotion.maxUsagePerUser,
          cartTotal: cartTotal,
          minOrderAmount: promotion.minOrderAmount
        });
        
        let errorMessage = 'Promotion cannot be applied to this cart';
        if (!isValid) {
          if (!promotion.isActive) errorMessage = 'Promotion is not active';
          else if (promotion.startDate > now) errorMessage = 'Promotion has not started yet';
          else if (promotion.endDate < now) errorMessage = 'Promotion has expired';
          else if (promotion.maxUsage > 0 && promotion.currentUsage >= promotion.maxUsage) errorMessage = 'Promotion usage limit exceeded';
        } else if (userUsageCount >= promotion.maxUsagePerUser) {
          errorMessage = 'You have already used this promotion maximum times';
        } else if (cartTotal < promotion.minOrderAmount) {
          errorMessage = `Minimum order amount of ${promotion.minOrderAmount} required`;
        }
        
        return res.status(400).json({
          success: false,
          error: errorMessage
        });
      }
      
      // Apply promotion - WITH ENHANCED DEBUGGING
      console.log('Attempting to apply promotion to cart...');
      const appliedDiscounts = promotion.applyToCart(cart);
      
      console.log('Applied discounts result:', appliedDiscounts);
      
      if (appliedDiscounts.length === 0) {
        // Additional debugging for why no discounts were applied
        console.log('No discounts applied - debugging product applicability:');
        
        for (const cartItem of cart.items) {
          const product = cartItem.product;
          const isApplicable = promotion.isProductApplicable(product);
          console.log('Product applicability check:', {
            productId: product._id,
            productName: product.ItemName || product.name,
            quantity: cartItem.quantity,
            price: cartItem.price,
            isApplicable: isApplicable,
            productCategory: product.ItemsGroupCode
          });
        }
        
        // Check rule-specific requirements
        if (promotion.type === 'buyXGetY' && promotion.rule.buyXGetY) {
          console.log('BuyXGetY rule check:', {
            buyQuantity: promotion.rule.buyXGetY.buyQuantity,
            getQuantity: promotion.rule.buyXGetY.getQuantity,
            cartItemQuantities: cart.items.map(item => ({ 
              productId: item.product._id, 
              quantity: item.quantity 
            }))
          });
        } else if (promotion.type === 'quantityDiscount' && promotion.rule.quantityDiscount) {
          console.log('QuantityDiscount rule check:', {
            minQuantity: promotion.rule.quantityDiscount.minQuantity,
            cartItemQuantities: cart.items.map(item => ({ 
              productId: item.product._id, 
              quantity: item.quantity 
            }))
          });
        } else if (promotion.type === 'cartTotal' && promotion.rule.cartTotal) {
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
          console.log('CartTotal rule check:', {
            minAmount: promotion.rule.cartTotal.minAmount,
            cartTotal: cartTotal
          });
        }
        
        return res.status(400).json({
          success: false,
          error: 'No discounts applicable for this cart. Please check if your cart items meet the promotion requirements.',
          debug: {
            promotionType: promotion.type,
            rule: promotion.rule,
            cartItems: cart.items.map(item => ({
              productId: item.product._id,
              productName: item.product.ItemName || item.product.name,
              quantity: item.quantity,
              price: item.price
            }))
          }
        });
      }

      // Handle buyXGetY promotions - add free items to cart
      if (promotion.type === 'buyXGetY' && appliedDiscounts.length > 0) {
        console.log('Processing buyXGetY free items...');
        
        for (const discount of appliedDiscounts) {
          if (discount.type === 'buyXGetY' && discount.freeQuantity > 0) {
            const productId = discount.productId;
            const freeQuantity = discount.freeQuantity;
            
            // Find the product
            const product = await Item.findById(productId);
            if (!product) {
              console.log('Product not found for free item:', productId);
              continue;
            }
            
            // Check if the product already exists in cart
            const existingItemIndex = cart.items.findIndex(
              item => item.product && item.product._id && item.product._id.toString() === productId.toString()
            );
            
            if (existingItemIndex > -1) {
              // Add free quantity to existing item
              const existingItem = cart.items[existingItemIndex];
              const originalQuantity = existingItem.quantity;
              existingItem.quantity += freeQuantity;
              
              // Set the freeQuantity field to track how many are free
              if (!existingItem.freeQuantity) {
                existingItem.freeQuantity = 0;
              }
              existingItem.freeQuantity += freeQuantity;
              
              console.log(`Added ${freeQuantity} free items to existing cart item:`, {
                productName: product.ItemName,
                originalQuantity: originalQuantity,
                newQuantity: existingItem.quantity,
                freeQuantity: existingItem.freeQuantity
              });
            } else {
              // Add new item with free quantity
              cart.items.push({
                product: new mongoose.Types.ObjectId(productId),
                quantity: freeQuantity,
                price: product.PriceList?.[0]?.Price || 0, // Use actual product price for display
                isFreeItem: true,
                freeQuantity: freeQuantity
              });
              console.log(`Added new free item to cart:`, {
                productName: product.ItemName,
                quantity: freeQuantity,
                price: 0
              });
            }
          }
        }
        
              // Save the updated cart
      await cart.save();
      console.log('Cart updated with free items');
      
      // Re-populate the cart to ensure all product data is loaded
      await cart.populate([
        'items.product',
        {
          path: 'appliedPromotions.promotion',
          select: 'name description type code'
        }
      ]);
      }
      
      // Calculate total discount amount for usage tracking
      const totalDiscountAmount = appliedDiscounts.reduce((sum, discount) => sum + (discount.discountAmount || 0), 0);
      
      // DON'T update promotion usage tracking here - only on order placement
      // Usage will be tracked when order is actually placed
      console.log('Promotion applied to cart (usage will be tracked on order placement):', {
        promotionId: promotion._id,
        totalDiscountAmount: totalDiscountAmount
      });
      
      // Track applied promotion in cart
      try {
        // Check if promotion is already applied to cart
        const existingPromotionIndex = cart.appliedPromotions.findIndex(
          ap => ap.promotion && ap.promotion.toString() === promotion._id.toString()
        );
        
        if (existingPromotionIndex === -1) {
          // Add new applied promotion to cart (manual promotion)
          cart.appliedPromotions.push({
            promotion: promotion._id,
            appliedAt: new Date(),
            discountAmount: totalDiscountAmount,
            code: promotion.code,
            isAutoApplied: false // Explicitly mark as manual
          });
        } else {
          // Update existing applied promotion
          cart.appliedPromotions[existingPromotionIndex].discountAmount = totalDiscountAmount;
          cart.appliedPromotions[existingPromotionIndex].appliedAt = new Date();
          cart.appliedPromotions[existingPromotionIndex].isAutoApplied = false; // Ensure it's marked as manual
        }
        
        await cart.save();
        console.log('Applied promotion tracked in cart:', {
          cartId: cart._id,
          promotionId: promotion._id,
          totalDiscountAmount: totalDiscountAmount,
          isManual: true
        });
      } catch (cartError) {
        console.error('Error tracking applied promotion in cart:', cartError);
        // Don't fail the promotion application if cart tracking fails
      }
      
      // After applying manual promotion, re-run auto-apply to check for additional auto promotions
      cart = await autoApplyPromotions(cart, cart.store, req.user._id);
      await cart.save();

      // Re-populate after auto-apply
      await cart.populate([
        'items.product',
        {
          path: 'appliedPromotions.promotion',
          select: 'name description type code'
        }
      ]);

      // Get ALL applied promotions for final totals calculation
      const allAppliedPromotions = [];
      if (cart.appliedPromotions && cart.appliedPromotions.length > 0) {
        for (const appliedPromo of cart.appliedPromotions) {
          const promotion = await Promotion.findById(appliedPromo.promotion);
          if (promotion) {
            allAppliedPromotions.push(promotion);
          }
        }
      }

      // Calculate totals with ALL applied promotions (manual + auto)
      const totals = await calculateCartTotals(cart, allAppliedPromotions);
      
      res.json({
        success: true,
        data: {
          promotion: {
            id: promotion._id,
            name: promotion.name,
            description: promotion.description,
            type: promotion.type,
            code: promotion.code
          },
          appliedDiscounts,
          cart: {
            ...cart.toObject(),
            ...totals
          },
          autoPromotionsAlsoApplied: cart.appliedPromotions.filter(ap => ap.isAutoApplied).length
        },
        message: `Promotion applied successfully${cart.appliedPromotions.filter(ap => ap.isAutoApplied).length > 0 ? ' (with additional auto-promotions)' : ''}`
      });
      
    } catch (error) {
      console.error('Error applying promotion:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Get applicable promotions for cart
  async getApplicablePromotions(req, res) {
    try {
      const { storeId } = req.query;
      let cart = await getOrCreateActiveCart(req.user._id, storeId);
      
      const applicablePromotions = await getApplicablePromotionsForCart(cart, cart.store, req.user._id);
      
      res.json({
        success: true,
        data: applicablePromotions.map(p => ({
          id: p._id,
          name: p.name,
          description: p.description,
          type: p.type,
          code: p.code,
          rule: p.rule,
          startDate: p.startDate,
          endDate: p.endDate
        }))
      });
      
    } catch (error) {
      console.error('Error getting applicable promotions:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Sync guest cart (existing method)
  async syncGuestCart(req, res) {
    try {
      const { guestCartItems, store } = req.body;
      
      if (!guestCartItems || !Array.isArray(guestCartItems)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Guest cart items array is required' 
        });
      }
      
      let cart = await getOrCreateActiveCart(req.user._id, store);
      
      // Process each guest cart item
      for (const guestItem of guestCartItems) {
        const { productId, quantity } = guestItem;
        
        if (!productId || !quantity) continue;
        
        // Find product
        const product = await Item.findById(productId);
        if (!product) continue;
        
        // Get price
        const price = getProductPrice(product);
        
        // Check if item already exists
        const existingItemIndex = cart.items.findIndex(
          item => item.product && item.product._id && item.product._id.toString() === productId
        );
        
        if (existingItemIndex > -1) {
          // Add to existing quantity
          cart.items[existingItemIndex].quantity += parseInt(quantity);
        } else {
          // Add new item
          cart.items.push({
            product: new mongoose.Types.ObjectId(productId),
            quantity: parseInt(quantity),
            price: price
          });
        }
      }
      
      cart.lastUpdated = new Date();
      await cart.save();
      await cart.populate([
        'items.product',
        {
          path: 'appliedPromotions.promotion',
          select: 'name description type code'
        }
      ]);
      
      // Get applicable promotions for display only (don't auto-apply)
      const applicablePromotions = await getApplicablePromotionsForCart(cart, cart.store, req.user._id);
      
      // Get ALL applied promotions from cart.appliedPromotions (both manual and auto)
      const allAppliedPromotions = [];
      if (cart.appliedPromotions && cart.appliedPromotions.length > 0) {
        for (const appliedPromo of cart.appliedPromotions) {
          const promotion = await Promotion.findById(appliedPromo.promotion);
          if (promotion) {
            allAppliedPromotions.push(promotion);
          }
        }
      }
      
      // Calculate totals with ALL applied promotions (manual + auto)
      const totals = await calculateCartTotals(cart, allAppliedPromotions);
      
      const cartData = {
        ...cart.toObject(),
        ...totals,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
        applicablePromotions: applicablePromotions.map(p => ({
          id: p._id,
          name: p.name,
          description: p.description,
          type: p.type,
          code: p.code
        }))
      };
      
      res.json({ success: true, data: cartData });
    } catch (err) {
      console.error('Error syncing guest cart:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // List abandoned carts (existing method)
  async listAbandoned(req, res) {
    try {
      const { hours = 24, page = 1, limit = 10 } = req.query;
      const skip = (page - 1) * limit;
      
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const abandonedCarts = await Cart.find({
        status: 'active',
        lastUpdated: { $lt: since },
        'items.0': { $exists: true }
      })
      .populate('user', 'name email')
      .populate('items.product', 'ItemName ItemCode image')
      .populate('store', 'name')
      .sort({ lastUpdated: -1 })
      .skip(skip)
      .limit(parseInt(limit));
      
      const total = await Cart.countDocuments({
        status: 'active',
        lastUpdated: { $lt: since },
        'items.0': { $exists: true }
      });
      
      res.json({
        success: true,
        data: abandonedCarts,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          totalItems: total
        }
      });
    } catch (err) {
      console.error('Error listing abandoned carts:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

// Remove promotion from cart - UPDATED VERSION
async removePromotion(req, res) {
  try {
    const { promotionId } = req.params;
    let cart = await getOrCreateActiveCart(req.user._id);
    
    // Ensure cart is populated
    await cart.populate([
      'items.product',
      {
        path: 'appliedPromotions.promotion',
        select: 'name description type code'
      }
    ]);
    
    // Find the promotion to remove
    const promotionIndex = cart.appliedPromotions.findIndex(
      ap => {
        // Handle both populated and unpopulated promotion objects
        let apPromotionId;
        if (ap.promotion && typeof ap.promotion === 'object' && ap.promotion._id) {
          // If promotion is populated (has _id field)
          apPromotionId = ap.promotion._id;
        } else {
          // If promotion is just an ObjectId
          apPromotionId = ap.promotion;
        }
        
        const apPromotionIdString = apPromotionId?.toString();
        const targetPromotionIdString = promotionId?.toString();
        
        return apPromotionIdString === targetPromotionIdString;
      }
    );
    
    if (promotionIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Promotion not found in cart'
      });
    }
    
    const promotionToRemove = cart.appliedPromotions[promotionIndex];
    
    // STEP 1: Check if this is an auto-applied promotion
    const isAutoApplied = promotionToRemove.isAutoApplied;
    console.log('Removing promotion:', {
      promotionId: promotionId,
      isAutoApplied: isAutoApplied,
      code: promotionToRemove.code
    });

    // Only decrement usage for manual promotions (auto promotions don't track usage until order)
    if (!isAutoApplied) {
      try {
        const promotion = await Promotion.findById(promotionId);
        if (promotion) {
          // Decrement currentUsage only for manual promotions
          if (promotion.currentUsage > 0) {
            promotion.currentUsage -= 1;
          }
          
          // Remove the usage history entry for this user that doesn't have an order reference
          const userUsageIndex = promotion.usageHistory.findIndex(
            usage => usage.user && usage.user.toString() === req.user._id.toString() && !usage.order
          );
          
          if (userUsageIndex !== -1) {
            promotion.usageHistory.splice(userUsageIndex, 1);
            console.log('Removed usage history entry for manual promotion:', promotion._id);
          }
          
          await promotion.save();
          console.log('Updated promotion usage tracking after manual removal:', {
            promotionId: promotion._id,
            newCurrentUsage: promotion.currentUsage
          });
        }
      } catch (usageError) {
        console.error('Error updating promotion usage tracking during removal:', usageError);
        // Continue with cart update even if usage tracking fails
      }
    }
    
    // STEP 2: Remove applied promotion record if it exists
    try {
      await AppliedPromotion.deleteMany({
        promotion: promotionId,
        user: req.user._id,
        order: null // Only remove if no order is associated (cart-level application)
      });
      console.log('Removed AppliedPromotion records for promotion:', promotionId);
    } catch (appliedPromotionError) {
      console.error('Error removing AppliedPromotion records:', appliedPromotionError);
      // Continue with cart update
    }
    
    // STEP 3: Remove the promotion from cart
    cart.appliedPromotions.splice(promotionIndex, 1);
    
    // STEP 4: Remove free items that were added by this promotion
    if (promotionToRemove.promotion) {
      const promotion = await Promotion.findById(promotionToRemove.promotion);
      if (promotion && promotion.type === 'buyXGetY') {
        // Remove free items that were added by this promotion
        cart.items = cart.items.filter(item => !item.isFreeItem || item.freeQuantity === 0);
        
        // Reset freeQuantity for items that had free quantities added - remove if quantity becomes 0
        cart.items = cart.items.filter(item => {
          if (item.freeQuantity && item.freeQuantity > 0) {
            const newQuantity = item.quantity - item.freeQuantity;
            if (newQuantity <= 0) {
              // Remove item entirely if no paid quantity remains
              return false;
            } else {
              // Update quantity and reset free quantity
              item.quantity = newQuantity;
              item.freeQuantity = 0;
              return true;
            }
          }
          return true;
        });
      }
    }
    
    await cart.save();
    
    // Re-populate the cart
    await cart.populate([
      'items.product',
      {
        path: 'appliedPromotions.promotion',
        select: 'name description type code'
      }
    ]);
    
    // Calculate totals
    const totals = await calculateCartTotals(cart, []);
    
    res.json({
      success: true,
      data: {
        message: 'Promotion removed successfully',
        cart: {
          ...cart.toObject(),
          ...totals
        }
      }
    });
  } catch (error) {
    console.error('Error removing promotion from cart:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove promotion from cart'
    });
  }
},

// Remove all promotions from cart - UPDATED VERSION
async removeAllPromotions(req, res) {
  try {
    let cart = await getOrCreateActiveCart(req.user._id);
    
    // Ensure cart is populated
    await cart.populate([
      'items.product',
      {
        path: 'appliedPromotions.promotion',
        select: 'name description type code'
      }
    ]);
    
    // STEP 1: Update usage tracking for each applied promotion
    for (const appliedPromotion of cart.appliedPromotions) {
      try {
        const promotion = await Promotion.findById(appliedPromotion.promotion);
        if (promotion) {
          // Decrement currentUsage
          if (promotion.currentUsage > 0) {
            promotion.currentUsage -= 1;
          }
          
          // Remove the usage history entry for this user
          const userUsageIndex = promotion.usageHistory.findIndex(
            usage => usage.user && usage.user.toString() === req.user._id.toString() && 
            (!usage.order || (usage.order && usage.usedAt && new Date() - new Date(usage.usedAt) < 24 * 60 * 60 * 1000))
          );
          
          if (userUsageIndex !== -1) {
            promotion.usageHistory.splice(userUsageIndex, 1);
          }
          
          await promotion.save();
        }
      } catch (usageError) {
        console.error('Error updating promotion usage tracking:', usageError);
      }
    }
    
    // STEP 2: Remove applied promotion records
    try {
      await AppliedPromotion.deleteMany({
        user: req.user._id,
        order: null // Only remove cart-level applications
      });
    } catch (appliedPromotionError) {
      console.error('Error removing AppliedPromotion records:', appliedPromotionError);
    }
    
    // STEP 3: Remove all promotions from cart
    cart.appliedPromotions = [];
    
    // STEP 4: Remove all free items that were added by promotions
    cart.items = cart.items.filter(item => !item.isFreeItem);
    
    // Reset freeQuantity for all items - remove if quantity becomes 0
    cart.items = cart.items.filter(item => {
      if (item.freeQuantity && item.freeQuantity > 0) {
        const newQuantity = item.quantity - item.freeQuantity;
        if (newQuantity <= 0) {
          // Remove item entirely if no paid quantity remains
          return false;
        } else {
          // Update quantity and reset free quantity
          item.quantity = newQuantity;
          item.freeQuantity = 0;
          return true;
        }
      }
      return true;
    });
    
    await cart.save();
    
    // Re-populate the cart
    await cart.populate([
      'items.product',
      {
        path: 'appliedPromotions.promotion',
        select: 'name description type code'
      }
    ]);
    
    // Calculate totals
    const totals = await calculateCartTotals(cart, []);
    
    res.json({
      success: true,
      data: {
        message: 'All promotions removed successfully',
        cart: {
          ...cart.toObject(),
          ...totals
        }
      }
    });
  } catch (error) {
    console.error('Error removing all promotions from cart:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove promotions from cart'
    });
  }
}
};