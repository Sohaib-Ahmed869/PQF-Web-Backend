const Item = require('../../Models/Product');
const { productUpload, deleteS3Object } = require('../../Config/S3');

// Utility function to shape product object for admin responses
function shapeProductForAdmin(product) {
  // Filter prices to allowed lists (1, 2, 3, 5)
  const allowedLists = new Set([1, 2, 3, 5]);
  const filteredPrices = (product.ItemPrices || []).filter(p =>
    allowedLists.has(p.PriceList)
  );

  // Calculate total stock across warehouses
  const warehouseInfo = product.ItemWarehouseInfoCollection || [];
  const totalStock = warehouseInfo.reduce(
    (sum, wh) => sum + (wh.InStock || 0), 0
  );

  return {
    id: product._id,
    ItemCode: product.ItemCode,
    ItemName: product.ItemName,
    ItemsGroupCode: product.ItemsGroupCode,
    image: product.image,
    imageKey: product.imageKey,
    prices: filteredPrices,
    store: product.store,
    
    // Stock & availability
    stock: totalStock,
    isAvailable: totalStock > 0,
    
    // Frozen details
    frozen: product.Frozen,
    frozenFrom: product.FrozenFrom,
    frozenTo: product.FrozenTo,
    frozenRemarks: product.FrozenRemarks,

    // Valid/Invalid status flags
    valid: product.Valid,
    validFrom: product.ValidFrom,
    validTo: product.ValidTo,
    validRemarks: product.ValidRemarks,
    // Warehouse breakdown
    warehouseInfo,
    description: product.Description
  };
}

// 1. GET ALL PRODUCTS
const getAllProducts = async (req, res) => {
  try {
    const {
      search = '',
      category = '',
      inStock = '',
      sortBy = 'ItemName',
      sortOrder = 'asc',
      storeId
    } = req.query;

    // Build filter
    const filter = {};
    if (storeId) filter.store = storeId;
    if (search) {
      filter.$or = [
        { ItemName: { $regex: search, $options: 'i' } },
        { ItemCode: { $regex: search, $options: 'i' } },
        { ForeignName: { $regex: search, $options: 'i' } },
        { BarCode: { $regex: search, $options: 'i' } },
      ];
    }
    if (category) filter.ItemsGroupCode = category;
    if (inStock === 'true') filter.QuantityOnStock = { $gt: 0 };
    if (inStock === 'false') filter.QuantityOnStock = { $lte: 0 };

    // Sort options
    const sortOptions = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Fetch products
    const products = await Item.find(filter)
      .sort(sortOptions)
      .populate('store', 'name')
      .lean();

    // Shape products for response
    const shapedProducts = products.map(prod => shapeProductForAdmin(prod));

    return res.status(200).json({
      success: true,
      data: shapedProducts
    });
  } catch (error) {
    console.error('Error getting products:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve products',
      error: error.message
    });
  }
};

// 2. GET INDIVIDUAL PRODUCT
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const product = await Item.findOne({
      $or: [{ _id: id }, { ItemCode: id }]
    })
    .populate('store', 'name')
    .lean();
    
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const shaped = shapeProductForAdmin(product);

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

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined') {
      console.warn('Product update called with missing or invalid id:', id);
      return res.status(400).json({
        success: false,
        message: 'Product ID is required in the URL.'
      });
    }

    // Load existing product
    const product = await Item.findOne({
      $or: [{ _id: id }, { ItemCode: id }]
    });
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Allow updating image and/or description
    const updateData = {};
    if (req.file) {
      // Delete old image from S3 if exists
      if (product.imageKey) {
        await deleteS3Object(product.imageKey);
      }
      updateData.image = req.file.location;
      updateData.imagePath = req.file.key;
      updateData.imageKey = req.file.key;
    }
    if (req.body.description !== undefined) {
      updateData.Description = req.body.description;
    }
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No update data provided'
      });
    }

    // Persist changes
    const updated = await Item.findByIdAndUpdate(
      product._id,
      updateData,
      { new: true, runValidators: true }
    ).populate('store', 'name');

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: shapeProductForAdmin(updated)
    });
  } catch (err) {
    console.error('Error updating product image:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update product image',
      error: err.message
    });
  }
};

// 6. DELETE PRODUCT
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined') {
      console.warn('Product delete called with missing or invalid id:', id);
      return res.status(400).json({
        success: false,
        message: 'Product ID is required in the URL.'
      });
    }
    
    // Find the product first to get image key
    const product = await Item.findOne({
      $or: [
        { _id: id },
        { ItemCode: id }
      ]
    });
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Delete image from S3 if exists
    if (product.imageKey) {
      await deleteS3Object(product.imageKey);
    }
    
    // Delete the product
    await Item.findByIdAndDelete(product._id);
    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
      error: error.message
    });
  }
};

// 7. BULK DELETE PRODUCTS
const bulkDeleteProducts = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of product IDs'
      });
    }
    
    // Find all products to get their image keys
    const products = await Item.find({
      $or: [
        { _id: { $in: ids } },
        { ItemCode: { $in: ids } }
      ]
    });
    
    // Delete all images from S3
    const deletePromises = products
      .filter(product => product.imageKey)
      .map(product => deleteS3Object(product.imageKey));
    await Promise.all(deletePromises);
    
    // Delete products from database
    const result = await Item.deleteMany({
      $or: [
        { _id: { $in: ids } },
        { ItemCode: { $in: ids } }
      ]
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} products`
    });
  } catch (error) {
    console.error('Error bulk deleting products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete products',
      error: error.message
    });
  }
};

// GET PRODUCTS BY CATEGORY
const getProductsByCategory = async (req, res) => {
  try {
    const { category } = req.query;
    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Category is required as a query parameter.'
      });
    }

    // Build filter for category
    const filter = { ItemsGroupCode: category };

    // Fetch products
    const products = await Item.find(filter)
      .populate('store', 'name')
      .lean();

    // Shape products for response
    const shapedProducts = products.map(prod => shapeProductForAdmin(prod));

    return res.status(200).json({
      success: true,
      data: shapedProducts
    });
  } catch (error) {
    console.error('Error getting products by category:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve products by category',
      error: error.message
    });
  }
};

// AUTO-SUGGEST PRODUCT NAMES
const suggestProductNames = async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Query parameter "q" is required for suggestions.'
      });
    }
    
    // Find product names that match the query (case-insensitive, partial match)
    const products = await Item.find(
      { ItemName: { $regex: q, $options: 'i' } },
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
    console.error('Error suggesting product names:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to suggest product names',
      error: error.message
    });
  }
};

// GET PRODUCT STOCK BY WAREHOUSE
const getProductStockByWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    const { warehouseCode } = req.query;

    const product = await Item.findOne({
      $or: [
        { _id: id },
        { ItemCode: id }
      ]
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (warehouseCode) {
      // Get stock for specific warehouse
      const stock = product.getWarehouseStock(warehouseCode);
      res.status(200).json({
        success: true,
        data: {
          ItemCode: product.ItemCode,
          ItemName: product.ItemName,
          WarehouseCode: warehouseCode,
          Stock: stock
        }
      });
    } else {
      // Get stock for all warehouses
      res.status(200).json({
        success: true,
        data: {
          ItemCode: product.ItemCode,
          ItemName: product.ItemName,
          TotalStock: product.QuantityOnStock,
          WarehouseStocks: product.ItemWarehouseInfoCollection
        }
      });
    }

  } catch (error) {
    console.error('Error getting product stock:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve product stock',
      error: error.message
    });
  }
};

// UPDATE PRODUCT STOCK
const updateProductStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { warehouseCode, quantity, operation = 'set' } = req.body;

    const product = await Item.findOne({
      $or: [
        { _id: id },
        { ItemCode: id }
      ]
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Find warehouse info
    const warehouseInfo = product.ItemWarehouseInfoCollection.find(
      wh => wh.WarehouseCode === warehouseCode
    );

    if (!warehouseInfo) {
      return res.status(404).json({
        success: false,
        message: 'Warehouse not found for this product'
      });
    }

    // Update stock based on operation
    let newStock = warehouseInfo.InStock;
    switch (operation) {
      case 'add':
        newStock += quantity;
        break;
      case 'subtract':
        newStock -= quantity;
        break;
      case 'set':
      default:
        newStock = quantity;
        break;
    }

    // Ensure stock doesn't go below 0
    newStock = Math.max(0, newStock);

    // Update warehouse stock
    warehouseInfo.InStock = newStock;

    // Recalculate total stock
    product.QuantityOnStock = product.ItemWarehouseInfoCollection.reduce(
      (total, wh) => total + wh.InStock, 0
    );

    await product.save();

    res.status(200).json({
      success: true,
      message: 'Product stock updated successfully',
      data: {
        ItemCode: product.ItemCode,
        ItemName: product.ItemName,
        WarehouseCode: warehouseCode,
        NewStock: newStock,
        TotalStock: product.QuantityOnStock
      }
    });

  } catch (error) {
    console.error('Error updating product stock:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product stock',
      error: error.message
    });
  }
};

// GET ALL PRODUCT NAMES
const getAllProductNames = async (req, res) => {
  try {
    const products = await Item.find({}, 'ItemName').lean();
    const productNames = products.map(p => p.ItemName);
    res.status(200).json({
      success: true,
      data: productNames
    });
  } catch (error) {
    console.error('Error getting product names:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve product names',
      error: error.message
    });
  }
};

module.exports = {
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  getProductStockByWarehouse,
  updateProductStock,
  getAllProductNames,
  getProductsByCategory,
  suggestProductNames
};