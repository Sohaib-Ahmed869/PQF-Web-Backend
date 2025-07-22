const Cart = require('../Models/Cart');
const Item = require('../Models/Product');
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
      await cart.populate('items.product');
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

module.exports = {
  // Get current user's cart
  async getCart(req, res) {
    try {
      const cart = await getOrCreateActiveCart(req.user._id);
      
      // Calculate totals
      const total = cart.items.reduce((sum, item) => {
        return sum + (item.price * item.quantity);
      }, 0);
      
      const cartData = {
        ...cart.toObject(),
        total,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
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
      const cart = await getOrCreateActiveCart(req.user._id, store);
      
      // Get current price
      const price = getProductPrice(product);
      
      // Check if item already exists in cart
      const existingItemIndex = cart.items.findIndex(
        item => item.product._id.toString() === productId
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
      await cart.save();
      
      // Populate and return updated cart
      await cart.populate('items.product');
      
      const total = cart.items.reduce((sum, item) => {
        return sum + (item.price * item.quantity);
      }, 0);
      
      const cartData = {
        ...cart.toObject(),
        total,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
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
      
      const cart = await getOrCreateActiveCart(req.user._id, store);
      
      // Remove item
      cart.items = cart.items.filter(
        item => item.product._id.toString() !== productId
      );
      
      cart.lastUpdated = new Date();
      await cart.save();
      await cart.populate('items.product');
      
      const total = cart.items.reduce((sum, item) => {
        return sum + (item.price * item.quantity);
      }, 0);
      
      const cartData = {
        ...cart.toObject(),
        total,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
      };
      
      res.json({ success: true, data: cartData });
    } catch (err) {
      console.error('Error removing item from cart:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Update item quantity
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
          error: 'Quantity must be positive' 
        });
      }
      
      const cart = await getOrCreateActiveCart(req.user._id, store);
      
      const itemIndex = cart.items.findIndex(
        item => item.product._id.toString() === productId
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
        // Update quantity
        cart.items[itemIndex].quantity = parseInt(quantity);
      }
      
      if (store) cart.store = store;
      cart.lastUpdated = new Date();
      await cart.save();
      await cart.populate('items.product');
      
      const total = cart.items.reduce((sum, item) => {
        return sum + (item.price * item.quantity);
      }, 0);
      
      const cartData = {
        ...cart.toObject(),
        total,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
      };
      
      res.json({ success: true, data: cartData });
    } catch (err) {
      console.error('Error updating cart item:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Clear cart
  async clearCart(req, res) {
    try {
      const cart = await getOrCreateActiveCart(req.user._id, req.body.store);
      cart.items = [];
      cart.lastUpdated = new Date();
      await cart.save();
      
      const cartData = {
        ...cart.toObject(),
        total: 0,
        itemCount: 0
      };
      
      res.json({ success: true, data: cartData });
    } catch (err) {
      console.error('Error clearing cart:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Sync guest cart with user cart
  async syncGuestCart(req, res) {
    try {
      const { items = [], store } = req.body;
      const cart = await getOrCreateActiveCart(req.user._id, store);
      
      for (const guestItem of items) {
        const product = await Item.findById(guestItem.product);
        if (product) {
          const price = getProductPrice(product);
          const existingItemIndex = cart.items.findIndex(
            item => item.product._id.toString() === guestItem.product
          );
          
          if (existingItemIndex > -1) {
            cart.items[existingItemIndex].quantity += guestItem.quantity;
          } else {
            cart.items.push({
              product: new mongoose.Types.ObjectId(guestItem.product),
              quantity: guestItem.quantity,
              price: price
            });
          }
        }
      }
      
      if (store) cart.store = store;
      cart.lastUpdated = new Date();
      await cart.save();
      await cart.populate('items.product');
      
      const total = cart.items.reduce((sum, item) => {
        return sum + (item.price * item.quantity);
      }, 0);
      
      const cartData = {
        ...cart.toObject(),
        total,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
      };
      
      res.json({ success: true, data: cartData });
    } catch (err) {
      console.error('Error syncing guest cart:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
  // List abandoned carts (admin)
  async listAbandoned(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const carts = await Cart.find({ 
        status: 'active', 
        lastUpdated: { $lt: since },
        'items.0': { $exists: true } // Only carts with items
      })
      .populate('user', 'name email')
      .populate('items.product', 'ItemName ItemCode');
      
      res.json({ success: true, data: carts });
    } catch (err) {
      console.error('Error listing abandoned carts:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
};