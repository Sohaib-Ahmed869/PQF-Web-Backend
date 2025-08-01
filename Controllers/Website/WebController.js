const Banner = require('../../Models/Banner');
const Category = require('../../Models/Category');
const Store = require('../../Models/Store');
const Product = require('../../Models/Product');
const Cart = require('../../Models/Cart');

// Utility function to shape product object for responses
function shapeProduct(product) {
  const allowedLists = new Set([1, 2, 3, 5]);
  const filteredPrices = (product.ItemPrices || []).filter(p =>
    allowedLists.has(p.PriceList)
  );
  const warehouseInfo = product.ItemWarehouseInfoCollection || [];
  const totalStock = warehouseInfo.reduce((sum, wh) => sum + (wh.InStock || 0), 0);
  return {
    id: product._id,
    ItemCode: product.ItemCode,
    ItemName: product.ItemName,
    ItemsGroupCode: product.ItemsGroupCode,
    image: product.image,
    imageKey: product.imageKey,
    prices: filteredPrices,
    store: product.store,
    stock: totalStock,
    isAvailable: totalStock > 0,
    frozen: product.Frozen,
    frozenFrom: product.FrozenFrom,
    frozenTo: product.FrozenTo,
    frozenRemarks: product.FrozenRemarks,
    valid: product.Valid,
    validFrom: product.ValidFrom,
    validTo: product.ValidTo,
    validRemarks: product.ValidRemarks,
    warehouseInfo,
    description: product.Description // Fixed: use capital D to match model
  };
}

// Utility function to flatten category object (copied from Admin/CategoryController.js)
function flattenCategory(category) {
  const flat = {
    _id: category._id,
    name: category.name,
    ItemsGroupCode: category.ItemsGroupCode,
    image: category.image,
    imageKey: category.imageKey,
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    __v: category.__v,
  };
  if (category.store) {
    flat.store_id = category.store._id;
    flat.store_name = category.store.name;
    if (category.store.location && category.store.location.address) {
      const addr = category.store.location.address;
      flat.store_address_street = addr.street || null;
      flat.store_address_city = addr.city || null;
      flat.store_address_state = addr.state || null;
      flat.store_address_zipCode = addr.zipCode || null;
      flat.store_address_country = addr.country || null;
    }
  }
  return flat;
}

// 1. Get active banners for a selected store
const getActiveBannersByStore = async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'storeId is required' });
    }
    const banners = await Banner.find({ store: storeId, isVisible: true });
    return res.status(200).json({
      success: true,
      count: banners.length,
      data: banners
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Get active categories for a selected store
const getActiveCategoriesByStore = async (req, res) => {  
  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'storeId is required' });
    }
    const categories = await Category.find({ store: storeId, isActive: true }).populate('store', 'name location.address');
    // For each category, fetch products and add as 'items' array
    const categoriesWithItems = await Promise.all(
      categories.map(async (category) => {
        const items = await Product.find({
          ItemsGroupCode: category.ItemsGroupCode,
          store: storeId,
          Valid: 'tYES',
          QuantityOnStock: { $gt: 0 }
        }).lean();
        return {
          ...flattenCategory(category),
          items: items.map(shapeProduct),
          itemCount: items.length
        };
      })
    );
    return res.status(200).json({
      success: true,
      count: categoriesWithItems.length,
      data: categoriesWithItems
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Get all active stores
const getActiveStores = async (req, res) => {
  try {
    const stores = await Store.find({ status: 'active' });
    return res.status(200).json({
      success: true,
      count: stores.length,
      data: stores
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Get top 12 featured products with highest stock for a selected store
const getFeaturedProducts = async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'storeId is required' });
    }
    
    // Get products that are in stock, available, and sort by stock quantity (highest first)
    const products = await Product.find({ 
      store: storeId, 
      Valid: 'tYES',
      QuantityOnStock: { $gt: 0 } 
    })
      .sort({ QuantityOnStock: -1 }) // Sort by stock quantity descending
      .limit(12)
      .lean();
      
    const shapedProducts = products.map(shapeProduct);
    return res.status(200).json({
      success: true,
      count: shapedProducts.length,
      data: shapedProducts
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get top 3 active products for a selected store (keeping for backward compatibility)
const getTop3ActiveProductsByStore = async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'storeId is required' });
    }
    const products = await Product.find({ store: storeId, QuantityOnStock: { $gt: 0 } })
      .sort({ createdAt: -1 })
      .limit(12)
      .lean();
    const shapedProducts = products.map(shapeProduct);
    return res.status(200).json({
      success: true,
      count: shapedProducts.length,
      data: shapedProducts
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Get all active products for a selected store
const getActiveProductsByStore = async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'storeId is required' });
    }
    const products = await Product.find({ store: storeId, QuantityOnStock: { $gt: 0 } }).lean();
    const shapedProducts = products.map(shapeProduct);
    return res.status(200).json({
      success: true,
      count: shapedProducts.length,
      data: shapedProducts
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Get all active products for a selected store and category
const getActiveProductsByStoreAndCategory = async (req, res) => {
  try {
    const { storeId, category } = req.query;
    if (!storeId || !category) {
      return res.status(400).json({ success: false, message: 'storeId and category are required' });
    }
    const products = await Product.find({
      store: storeId,
      ItemsGroupCode: category,
      Valid: 'tYES',
      QuantityOnStock: { $gt: 0 }
    }).lean();
    const shapedProducts = products.map(shapeProduct);
    return res.status(200).json({
      success: true,
      count: shapedProducts.length,
      data: shapedProducts
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Suggest product names for autocomplete
const suggestProductNames = async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Query parameter "q" is required for suggestions.'
      });
    }
    // Find product names that match the query (case-insensitive, partial match), only active (Valid: 'tYES')
    const products = await Product.find(
      { ItemName: { $regex: q, $options: 'i' }, Valid: 'tYES' },
      'ItemName'
    )
      .limit(10)
      .lean();
    const suggestions = products.map(p => p.ItemName);
    return res.status(200).json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to suggest product names',
      error: error.message
    });
  }
};

// Search products by name/code, only active
const searchProducts = async (req, res) => {
  try {
    const { search = '', storeId } = req.query;
    if (!search) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required.'
      });
    }
    // Build filter
    const filter = { Valid: 'tYES' };
    if (storeId) filter.store = storeId;
    filter.$or = [
      { ItemName: { $regex: search, $options: 'i' } },
      { ItemCode: { $regex: search, $options: 'i' } }
    ];
    const products = await Product.find(filter).lean();
    const shapedProducts = products.map(shapeProduct);
    return res.status(200).json({
      success: true,
      data: shapedProducts
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to search products',
      error: error.message
    });
  }
};

// 2. GET INDIVIDUAL PRODUCT
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const product = await Product.findOne({
      $or: [{ _id: id }, { ItemCode: id }]
    })
    .populate('store', 'name')
    .lean();
    
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const shaped = shapeProduct(product);

    return res.status(200).json({ success: true, data: shaped });
  } catch (error) {
    console.error('Error getting product:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve product',
      error: error.message
    });
  }
};

// Get abandoned carts for a specific user
const getUserAbandonedCarts = async (req, res) => {
  try {
    const userId = req.user._id; // Get user ID from authenticated request
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required' 
      });
    }

    // First, automatically mark old active carts as abandoned for this user
    const hours = 24; // 24 hours threshold
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const updateResult = await Cart.updateMany(
      { 
        user: userId,
        status: 'active', 
        lastUpdated: { $lt: since },
        'items.0': { $exists: true } // Only carts with items
      },
      { 
        $set: { 
          status: 'abandoned',
          lastUpdated: new Date() // Update timestamp when marking as abandoned
        } 
      }
    );
    
    console.log(`Marked ${updateResult.modifiedCount} carts as abandoned for user ${userId}`);

    // Find abandoned carts for the specific user
    const abandonedCarts = await Cart.find({
      user: userId,
      status: 'abandoned'
    })
    .populate('items.product', 'ItemName ItemCode image')
    .populate('store', 'name')
    .sort({ lastUpdated: -1 }); // Most recent first

    // Transform the data to match frontend expectations
    const transformedCarts = abandonedCarts.map(cart => ({
      _id: cart._id,
      user: {
        _id: cart.user,
        name: req.user.name || req.user.email,
        email: req.user.email
      },
      items: cart.items.map(item => ({
        product: {
          _id: item.product._id,
          ItemName: item.product.ItemName,
          ItemCode: item.product.ItemCode,
          image: item.product.image
        },
        quantity: item.quantity,
        price: item.price
      })),
      total: cart.total,
      itemCount: cart.itemCount,
      status: cart.status,
      store: cart.store,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
      lastUpdated: cart.lastUpdated,
      expiresAt: cart.expiresAt
    }));

    return res.status(200).json({
      success: true,
      count: transformedCarts.length,
      data: transformedCarts,
      markedAsAbandoned: updateResult.modifiedCount
    });

  } catch (error) {
    console.error('Error fetching user abandoned carts:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch abandoned carts',
      error: error.message 
    });
  }
};

// Reorder from an abandoned cart: add all items to the user's active cart
const reorderAbandonedCart = async (req, res) => {
  try {
    const userId = req.user._id;
    const { cartId } = req.params;
    if (!userId || !cartId) {
      return res.status(400).json({ success: false, message: 'User ID and cart ID are required' });
    }
    // Find the abandoned cart and verify ownership
    const abandonedCart = await Cart.findOne({ _id: cartId, user: userId, status: 'abandoned' }).populate('items.product');
    if (!abandonedCart) {
      return res.status(404).json({ success: false, message: 'Abandoned cart not found' });
    }
    if (!abandonedCart.items || abandonedCart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Abandoned cart is empty' });
    }
    // Change status to active and update lastUpdated
    abandonedCart.status = 'active';
    abandonedCart.lastUpdated = new Date();
    await abandonedCart.save();
    return res.status(200).json({
      success: true,
      message: 'Cart reactivated',
      data: {
        cartId: abandonedCart._id,
        itemCount: abandonedCart.itemCount,
        total: abandonedCart.total,
        status: abandonedCart.status
      }
    });
  } catch (error) {
    console.error('Error reordering abandoned cart:', error);
    return res.status(500).json({ success: false, message: 'Failed to reorder abandoned cart', error: error.message });
  }
};

module.exports = {
  getActiveBannersByStore,
  getActiveCategoriesByStore,
  getActiveStores,
  getFeaturedProducts,
  getTop3ActiveProductsByStore,
  getActiveProductsByStore,
  getActiveProductsByStoreAndCategory,
  suggestProductNames,
  searchProducts,
  getProductById,
  getUserAbandonedCarts,
  reorderAbandonedCart
};
