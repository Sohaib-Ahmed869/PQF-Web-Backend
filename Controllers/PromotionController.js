const Promotion = require('../Models/Promotion');
const AppliedPromotion = require('../Models/AppliedPromotion');
const Cart = require('../Models/Cart');
const Item = require('../Models/Product');
const Category = require('../Models/Category');
const mongoose = require('mongoose');

module.exports = {
  // Create a new promotion
  async createPromotion(req, res) {
    try {
      const {
        name,
        description,
        code,
        type,
        rule,
        applicableProducts,
        applicableCategories,
        store,
        startDate,
        endDate,
        maxUsage,
        maxUsagePerUser,
        priority,
        minOrderAmount,
        excludedProducts,
        excludedCategories
      } = req.body;

      // Validate required fields
      if (!name || !type || !rule || !store || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: name, type, rule, store, endDate'
        });
      }

      // Validate promotion type and rule structure
      if (!['buyXGetY', 'quantityDiscount', 'cartTotal'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid promotion type'
        });
      }

      // Validate rule structure based on type
      if (!validatePromotionRule(type, rule)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid rule structure for promotion type'
        });
      }

      // Check if code already exists (if provided)
      if (code) {
        const existingPromotion = await Promotion.findOne({ code: code.toUpperCase() });
        if (existingPromotion) {
          return res.status(400).json({
            success: false,
            error: 'Promotion code already exists'
          });
        }
      }

      // Create promotion
      const promotion = new Promotion({
        name,
        description,
        code: code ? code.toUpperCase() : undefined,
        type,
        rule,
        applicableProducts: applicableProducts || [],
        applicableCategories: applicableCategories || [],
        store,
        startDate: startDate || new Date(),
        endDate,
        maxUsage: maxUsage || 0,
        maxUsagePerUser: maxUsagePerUser || 1,
        priority: priority || 1,
        minOrderAmount: minOrderAmount || 0,
        excludedProducts: excludedProducts || [],
        excludedCategories: excludedCategories || [],
        createdBy: req.user._id
      });

      await promotion.save();
      await promotion.populate([
        { path: 'applicableProducts', select: 'ItemName _id' },
        { path: 'applicableCategories', select: 'name _id ItemsGroupCode' },
        { path: 'excludedProducts', select: 'ItemName _id' },
        { path: 'excludedCategories', select: 'name _id ItemsGroupCode' }
      ]);

      res.status(201).json({
        success: true,
        data: promotion,
        message: 'Promotion created successfully'
      });

    } catch (error) {
      console.error('Error creating promotion:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Get all promotions for a store
  async getPromotions(req, res) {
    try {
      const { store, isActive, type, page = 1, limit = 10 } = req.query;
      const skip = (page - 1) * limit;

      let query = {};
      
      if (store) query.store = store;
      if (isActive !== undefined) query.isActive = isActive === 'true';
      if (type) query.type = type;

      const promotions = await Promotion.find(query)
        .populate([
          { path: 'applicableProducts', select: 'ItemName _id' },
          { path: 'applicableCategories', select: 'name _id ItemsGroupCode' },
          { path: 'excludedProducts', select: 'ItemName _id' },
          { path: 'excludedCategories', select: 'name _id ItemsGroupCode' },
          { path: 'store', select: 'name' }
        ])
        .sort({ priority: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Promotion.countDocuments(query);

      res.json({
        success: true,
        data: promotions,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          totalItems: total
        }
      });

    } catch (error) {
      console.error('Error getting promotions:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Get public promotions for a store (no authentication required)
  async getPublicPromotions(req, res) {
    try {
      const { store, isActive, type, page = 1, limit = 50 } = req.query;
      const skip = (page - 1) * limit;

      let query = {};
      
      // Only show active promotions for public access
      query.isActive = true;
      
      // Only show currently valid promotions (within date range)
      const now = new Date();
      query.startDate = { $lte: now };
      query.endDate = { $gte: now };
      
      if (store) query.store = store;
      if (type) query.type = type;

      const promotions = await Promotion.find(query)
        .populate([
          { path: 'applicableProducts', select: 'ItemName _id' },
          { path: 'applicableCategories', select: 'name _id ItemsGroupCode' },
          { path: 'excludedProducts', select: 'ItemName _id' },
          { path: 'excludedCategories', select: 'name _id ItemsGroupCode' },
          { path: 'store', select: 'name' }
        ])
        .sort({ priority: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Promotion.countDocuments(query);

      res.json({
        success: true,
        data: promotions,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          totalItems: total
        }
      });

    } catch (error) {
      console.error('Error getting public promotions:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Get a specific promotion
  async getPromotion(req, res) {
    try {
      const { id } = req.params;

      const promotion = await Promotion.findById(id)
        .populate([
          { path: 'applicableProducts', select: 'ItemName _id' },
          { path: 'applicableCategories', select: 'name _id ItemsGroupCode' },
          { path: 'excludedProducts', select: 'ItemName _id' },
          { path: 'excludedCategories', select: 'name _id ItemsGroupCode' },
          { path: 'store', select: 'name' },
          { path: 'createdBy', select: 'name email' }
        ]);

      if (!promotion) {
        return res.status(404).json({
          success: false,
          error: 'Promotion not found'
        });
      }

      res.json({
        success: true,
        data: promotion
      });

    } catch (error) {
      console.error('Error getting promotion:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Update a promotion
  async updatePromotion(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const promotion = await Promotion.findById(id);
      if (!promotion) {
        return res.status(404).json({
          success: false,
          error: 'Promotion not found'
        });
      }

      // Validate rule structure if rule is being updated
      if (updateData.rule && !validatePromotionRule(promotion.type, updateData.rule)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid rule structure for promotion type'
        });
      }

      // Check if code already exists (if being updated)
      if (updateData.code && updateData.code !== promotion.code) {
        const existingPromotion = await Promotion.findOne({ code: updateData.code.toUpperCase() });
        if (existingPromotion) {
          return res.status(400).json({
            success: false,
            error: 'Promotion code already exists'
          });
        }
      }

      // Update promotion
      Object.assign(promotion, updateData);
      await promotion.save();
      await promotion.populate([
        { path: 'applicableProducts', select: 'ItemName _id' },
        { path: 'applicableCategories', select: 'name _id ItemsGroupCode' },
        { path: 'excludedProducts', select: 'ItemName _id' },
        { path: 'excludedCategories', select: 'name _id ItemsGroupCode' }
      ]);

      res.json({
        success: true,
        data: promotion,
        message: 'Promotion updated successfully'
      });

    } catch (error) {
      console.error('Error updating promotion:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Delete a promotion
  async deletePromotion(req, res) {
    try {
      const { id } = req.params;

      const promotion = await Promotion.findById(id);
      if (!promotion) {
        return res.status(404).json({
          success: false,
          error: 'Promotion not found'
        });
      }

      await Promotion.findByIdAndDelete(id);

      res.json({
        success: true,
        message: 'Promotion deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting promotion:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Apply promotion to cart
  async applyPromotionToCart(req, res) {
    try {
      const { promotionId, cartId } = req.body;

      if (!promotionId || !cartId) {
        return res.status(400).json({
          success: false,
          error: 'Promotion ID and Cart ID are required'
        });
      }

      // Find promotion
      const promotion = await Promotion.findById(promotionId);
      if (!promotion) {
        return res.status(404).json({
          success: false,
          error: 'Promotion not found'
        });
      }

      // Find cart
      const cart = await Cart.findById(cartId).populate('items.product');
      if (!cart) {
        return res.status(404).json({
          success: false,
          error: 'Cart not found'
        });
      }

      // Check if promotion can be applied
      if (!promotion.canApplyToCart(cart, req.user._id)) {
        return res.status(400).json({
          success: false,
          error: 'Promotion cannot be applied to this cart'
        });
      }

      // Apply promotion
      const appliedDiscounts = promotion.applyToCart(cart);
      
      if (appliedDiscounts.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No discounts applicable for this cart'
        });
      }

      // Calculate total discount
      const totalDiscount = appliedDiscounts.reduce((sum, discount) => sum + discount.discountAmount, 0);
      
      // Calculate cart totals
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
      const finalTotal = Math.max(0, originalTotal - totalDiscount);

      res.json({
        success: true,
        data: {
          promotion,
          appliedDiscounts,
          totalDiscount,
          originalTotal,
          finalTotal
        },
        message: 'Promotion applied successfully'
      });

    } catch (error) {
      console.error('Error applying promotion:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Get applicable promotions for a cart
  async getApplicablePromotions(req, res) {
    try {
      const { cartId, storeId } = req.query;

      if (!cartId || !storeId) {
        return res.status(400).json({
          success: false,
          error: 'Cart ID and Store ID are required'
        });
      }

      // Find cart
      const cart = await Cart.findById(cartId).populate('items.product');
      if (!cart) {
        return res.status(404).json({
          success: false,
          error: 'Cart not found'
        });
      }

      // Find applicable promotions
      const applicablePromotions = await Promotion.findApplicablePromotions(cart, storeId, req.user._id);

      res.json({
        success: true,
        data: applicablePromotions
      });

    } catch (error) {
      console.error('Error getting applicable promotions:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Validate promotion code
  async validatePromotionCode(req, res) {
    try {
      const { code, cartId, storeId } = req.body;

      if (!code || !cartId || !storeId) {
        return res.status(400).json({
          success: false,
          error: 'Code, Cart ID, and Store ID are required'
        });
      }

      // Find promotion by code
      const promotion = await Promotion.findOne({ 
        code: code.toUpperCase(),
        store: storeId,
        isActive: true
      });

      if (!promotion) {
        return res.status(404).json({
          success: false,
          error: 'Invalid promotion code'
        });
      }

      // Find cart
      const cart = await Cart.findById(cartId).populate('items.product');
      if (!cart) {
        return res.status(404).json({
          success: false,
          error: 'Cart not found'
        });
      }

      // Check if promotion can be applied
      if (!promotion.canApplyToCart(cart, req.user._id)) {
        return res.status(400).json({
          success: false,
          error: 'Promotion cannot be applied to this cart'
        });
      }

      // Apply promotion to get discount details
      const appliedDiscounts = promotion.applyToCart(cart);
      const totalDiscount = appliedDiscounts.reduce((sum, discount) => sum + discount.discountAmount, 0);
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
      const finalTotal = Math.max(0, originalTotal - totalDiscount);

      res.json({
        success: true,
        data: {
          promotion,
          appliedDiscounts,
          totalDiscount,
          originalTotal,
          finalTotal
        },
        message: 'Promotion code is valid'
      });

    } catch (error) {
      console.error('Error validating promotion code:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Get promotion statistics (Admin/SuperAdmin only)
  async getPromotionStats(req, res) {
    try {
      const { id } = req.params;
      const { startDate, endDate } = req.query;

      const promotion = await Promotion.findById(id);
      if (!promotion) {
        return res.status(404).json({
          success: false,
          error: 'Promotion not found'
        });
      }

      // Build date filter
      const dateFilter = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) dateFilter.$lte = new Date(endDate);

      // Get applied promotions for this promotion
      const appliedPromotions = await AppliedPromotion.find({
        promotion: id,
        ...(Object.keys(dateFilter).length > 0 && { appliedAt: dateFilter })
      }).populate('order', 'orderNumber totalAmount status');

      // Calculate statistics
      const totalUsage = appliedPromotions.length;
      const totalDiscount = appliedPromotions.reduce((sum, ap) => sum + ap.totalDiscountAmount, 0);
      const averageDiscount = totalUsage > 0 ? totalDiscount / totalUsage : 0;

      // Get usage by user
      const userUsage = await AppliedPromotion.aggregate([
        { $match: { promotion: new mongoose.Types.ObjectId(id) } },
        { $group: { _id: '$user', usageCount: { $sum: 1 } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { 'user.name': 1, 'user.email': 1, usageCount: 1 } }
      ]);

      res.json({
        success: true,
        data: {
          promotion: {
            _id: promotion._id,
            name: promotion.name,
            code: promotion.code,
            type: promotion.type
          },
          stats: {
            totalUsage,
            totalDiscount,
            averageDiscount,
            userUsage
          },
          appliedPromotions: appliedPromotions.slice(0, 10) // Limit to last 10
        }
      });

    } catch (error) {
      console.error('Error getting promotion stats:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Get consumed promotions for a user
  async getUserConsumedPromotions(req, res) {
    try {
      const { userId, store } = req.query;
      const user = req.user;

      // If userId is provided, use it (for admin access), otherwise use current user
      const targetUserId = userId || user._id;

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }

      // Build query
      const query = { user: targetUserId };
      if (store) query.store = store;

      // Get consumed promotions
      const consumedPromotions = await AppliedPromotion.find(query)
        .populate([
          { path: 'promotion', select: 'name code type description' },
          { path: 'order', select: 'orderNumber totalAmount status' },
          { path: 'store', select: 'name' }
        ])
        .sort({ appliedAt: -1 })
        .limit(50);

      res.json({
        success: true,
        data: consumedPromotions
      });

    } catch (error) {
      console.error('Error getting user consumed promotions:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
};

// Helper function to validate promotion rule structure
function validatePromotionRule(type, rule) {
  switch (type) {
    case 'buyXGetY':
      return rule.buyXGetY && 
             typeof rule.buyXGetY.buyQuantity === 'number' && 
             typeof rule.buyXGetY.getQuantity === 'number' &&
             rule.buyXGetY.buyQuantity > 0 &&
             rule.buyXGetY.getQuantity > 0;

    case 'quantityDiscount':
      return rule.quantityDiscount && 
             typeof rule.quantityDiscount.minQuantity === 'number' &&
             rule.quantityDiscount.minQuantity > 0 &&
             ((typeof rule.quantityDiscount.discountPercentage === 'number' && rule.quantityDiscount.discountPercentage >= 0 && rule.quantityDiscount.discountPercentage <= 100) ||
              (typeof rule.quantityDiscount.discountAmount === 'number' && rule.quantityDiscount.discountAmount >= 0));

    case 'cartTotal':
      return rule.cartTotal && 
             typeof rule.cartTotal.minAmount === 'number' &&
             rule.cartTotal.minAmount >= 0 &&
             ((typeof rule.cartTotal.discountPercentage === 'number' && rule.cartTotal.discountPercentage >= 0 && rule.cartTotal.discountPercentage <= 100) ||
              (typeof rule.cartTotal.discountAmount === 'number' && rule.cartTotal.discountAmount >= 0));

    default:
      return false;
  }
} 