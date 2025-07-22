const Item = require('../../Models/Product');
const Store = require('../../Models/Store');
const { productUpload, deleteS3Object } = require('../../Config/S3');

// Utility function to flatten product object (similar to category controller)
function flattenProduct(product) {
    const flat = {
      _id: product._id,
      ItemCode: product.ItemCode,
      ItemName: product.ItemName,
      ItemsGroupCode: product.ItemsGroupCode,
      image: product.image,
      imageKey: product.imageKey,
      prices: product.ItemPrices || [],
      frozen: product.Frozen,
      frozenFrom: product.FrozenFrom,
      frozenTo: product.FrozenTo,
      frozenRemarks: product.FrozenRemarks,
      // Status flags
      valid: product.Valid,
      validFrom: product.ValidFrom,
      validTo: product.ValidTo,
      validRemarks: product.ValidRemarks,
      warehouseInfo: product.ItemWarehouseInfoCollection || [],
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      __v: product.__v,
      Description: product.Description
    };
    
    // Calculate total stock
    const totalStock = flat.warehouseInfo.reduce((sum, wh) => sum + (wh.InStock || 0), 0);
    flat.stock = totalStock;
    flat.isAvailable = totalStock > 0;
    
    // Filter prices to allowed lists (1, 2, 3, 5)
    const allowedLists = new Set([1, 2, 3, 5]);
    flat.prices = flat.prices.filter(p => allowedLists.has(p.PriceList));
    
    if (product.store) {
      flat.store_id = product.store._id;
      flat.store_name = product.store.name;
      if (product.store.location && product.store.location.address) {
        const addr = product.store.location.address;
        flat.store_address_street = addr.street;
        flat.store_address_city = addr.city;
        flat.store_address_state = addr.state;
        flat.store_address_zipCode = addr.zipCode;
        flat.store_address_country = addr.country;
      }
    }
    
    return flat;
  }

const getAllProductsAllStores = async (req, res) => {
  try {
    const { 
      search = '',
      category = '',
      inStock = '',
      storeId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 50
    } = req.query;

    const filter = {};
    
    // Apply filters
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

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Calculate pagination
    // const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Item.find(filter)
      .populate('store', 'name location.address email')
      .sort(sortOptions)
      // .skip(skip)
      // .limit(parseInt(limit))
      .lean();

    const totalProducts = await Item.countDocuments(filter);

    // Flatten products for response
    const flattenedProducts = products.map(product => flattenProduct(product));

    res.json({
      success: true,
      count: flattenedProducts.length,
      totalCount: totalProducts,
      // currentPage: parseInt(page),
      // totalPages: Math.ceil(totalProducts / parseInt(limit)),
      data: flattenedProducts
    });
  } catch (error) {
    console.error('Error getting all products from all stores:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const getGlobalProductStats = async (req, res) => {
  try {
    const stats = await Item.aggregate([
      {
        $lookup: {
          from: 'stores',
          localField: 'store',
          foreignField: '_id',
          as: 'storeInfo'
        }
      },
      {
        $unwind: '$storeInfo'
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          availableProducts: {
            $sum: { $cond: [{ $gt: ["$QuantityOnStock", 0] }, 1, 0] }
          },
          outOfStockProducts: {
            $sum: { $cond: [{ $lte: ["$QuantityOnStock", 0] }, 1, 0] }
          },
          frozenProducts: {
            $sum: { $cond: [{ $eq: ["$Frozen", "tYES"] }, 1, 0] }
          },
          totalStoresWithProducts: {
            $addToSet: "$store"
          },
          totalStockValue: { $sum: "$QuantityOnStock" },
          avgStockPerProduct: { $avg: "$QuantityOnStock" }
        }
      },
      {
        $project: {
          totalProducts: 1,
          availableProducts: 1,
          outOfStockProducts: 1,
          frozenProducts: 1,
          totalStoresWithProducts: { $size: "$totalStoresWithProducts" },
          totalStockValue: 1,
          avgStockPerProduct: { $round: ["$avgStockPerProduct", 2] }
        }
      }
    ]);

    // Get store-wise statistics
    const storeStats = await Store.aggregate([
      {
        $lookup: {
          from: 'items',
          localField: '_id',
          foreignField: 'store',
          as: 'products'
        }
      },
      {
        $project: {
          _id: 1,
          storeName: '$name',
          storeEmail: '$email',
          totalProducts: { $size: '$products' },
          availableProducts: {
            $size: {
              $filter: {
                input: '$products',
                as: 'prod',
                cond: { $gt: ['$$prod.QuantityOnStock', 0] }
              }
            }
          },
          outOfStockProducts: {
            $size: {
              $filter: {
                input: '$products',
                as: 'prod',
                cond: { $lte: ['$$prod.QuantityOnStock', 0] }
              }
            }
          },
          frozenProducts: {
            $size: {
              $filter: {
                input: '$products',
                as: 'prod',
                cond: { $eq: ['$$prod.Frozen', 'tYES'] }
              }
            }
          },
          totalStockValue: {
            $sum: '$products.QuantityOnStock'
          }
        }
      },
      { $sort: { totalProducts: -1 } }
    ]);

    // Get category-wise statistics
    const categoryStats = await Item.aggregate([
      {
        $group: {
          _id: '$ItemsGroupCode',
          productCount: { $sum: 1 },
          totalStock: { $sum: '$QuantityOnStock' },
          availableProducts: {
            $sum: { $cond: [{ $gt: ["$QuantityOnStock", 0] }, 1, 0] }
          }
        }
      },
      { $sort: { productCount: -1 } },
      { $limit: 10 }
    ]);

    const result = stats.length > 0 ? stats[0] : {
      totalProducts: 0,
      availableProducts: 0,
      outOfStockProducts: 0,
      frozenProducts: 0,
      totalStoresWithProducts: 0,
      totalStockValue: 0,
      avgStockPerProduct: 0
    };

    delete result._id;
    result.storeStatistics = storeStats;
    result.topCategories = categoryStats;

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting global product stats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const getProductsBySpecificStore = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { 
      search = '',
      category = '',
      inStock = '',
      sortBy = 'ItemName',
      sortOrder = 'asc',
      page = 1,
      limit = 50
    } = req.query;

    const filter = { store: storeId };
    
    // Apply additional filters
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

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Item.find(filter)
      .populate('store', 'name location.address email')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const totalProducts = await Item.countDocuments(filter);

    // Flatten products for response
    const flattenedProducts = products.map(product => flattenProduct(product));

    res.json({
      success: true,
      count: flattenedProducts.length,
      totalCount: totalProducts,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalProducts / parseInt(limit)),
      data: flattenedProducts
    });
  } catch (error) {
    console.error('Error getting products by specific store:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

const updateAnyProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required in the URL.'
      });
    }

    // Find existing product
    const existingProduct = await Item.findById(id);
    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    let oldImageKey = null;
    const updateData = {};

    // Handle image update if provided
    if (req.files && req.files['image'] && req.files['image'][0]) {
      oldImageKey = existingProduct.imageKey;
      updateData.image = req.files['image'][0].location;
      updateData.imageKey = req.files['image'][0].key;
    } else if (req.file) {
      oldImageKey = existingProduct.imageKey;
      updateData.image = req.file.location;
      updateData.imageKey = req.file.key;
    }

    // Handle description update if provided
    if (req.body.description !== undefined) {
      updateData.Description = req.body.description;
    }

    // Only proceed if at least one field is being updated
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No update data provided.'
      });
    }

    // Update product
    const updatedProduct = await Item.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('store', 'name location.address');

    // Delete old image if new one was uploaded
    if (oldImageKey && updateData.imageKey) {
      await deleteS3Object(oldImageKey);
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: flattenProduct(updatedProduct)
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: error.message
    });
  }
};

const deleteAnyProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required in the URL.'
      });
    }

    const product = await Item.findById(id)
      .populate('store', 'name location.address');
    
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
    
    // Delete from database
    await Item.findByIdAndDelete(id);
    
    res.json({
      success: true,
      message: 'Product deleted successfully',
      data: flattenProduct(product)
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

const getAnyProductById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const product = await Item.findById(id)
      .populate('store', 'name location.address email');
    
    if (!product) {
      return res.status(404).json({ 
        success: false,
        message: 'Product not found' 
      });
    }

    res.json({
      success: true,
      data: flattenProduct(product)
    });
  } catch (error) {
    console.error('Error getting product by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};








module.exports = {
  getAllProductsAllStores,
  getGlobalProductStats,
  getProductsBySpecificStore,
  updateAnyProduct,
  deleteAnyProduct,
  getAnyProductById
};