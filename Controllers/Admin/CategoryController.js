const mongoose=require("mongoose")
const Category = require('../../Models/Category');
const Item = require('../../Models/Product'); // Import Item model
const { deleteS3Object } = require('../../Config/S3');
const jwt = require('jsonwebtoken');

// Helper to extract store ID from JWT token
function getStoreIdFromToken(req) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key');
    return decoded.assignedStore;
  } catch (error) {
    return null;
  }
}

// Utility function to flatten category object
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
  
  if (category.items) {
    flat.items = category.items;
  }
  
  if (category.itemCount !== undefined) {
    flat.itemCount = category.itemCount;
  }
  
  return flat;
}

const createCategory = async (req, res) => {
  try {
    const { name, ItemsGroupCode, isActive = true } = req.body;
    let image = req.body.image;
    let imageKey = '';

    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    // Check for unique name and ItemsGroupCode within the same store
    const existingName = await Category.findOne({ name, store: storeId });
    if (existingName) {
      return res.status(400).json({
        success: false,
        message: 'Category name already exists in this store.'
      });
    }
    const existingGroupCode = await Category.findOne({ ItemsGroupCode, store: storeId });
    if (existingGroupCode) {
      return res.status(400).json({
        success: false,
        message: 'Category group code already exists in this store.'
      });
    }

    // Handle image upload
    if (req.files && req.files['image'] && req.files['image'][0]) {
      image = req.files['image'][0].location;
      imageKey = req.files['image'][0].key;
    }

    // Create the category
    const category = new Category({ 
      name, 
      ItemsGroupCode, 
      image, 
      imageKey,
      store: storeId,
      isActive 
    });

    await category.save();

    return res.status(201).json({
      success: true,
      data: category
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

// Get all categories from all stores with detailed store information (ADMIN FUNCTION)
const getAllCategoriesAllStores = async (req, res) => {
  try {
    const { isActive, storeId, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const filter = {};
    
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (storeId) filter.store = storeId;
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
    
    const categories = await Category.find(filter)
      .populate('store', 'name location.address')
      .sort(sortOptions)
      .lean();

    // Add item counts and flatten items for each category
    const categoriesWithDetails = await Promise.all(
      categories.map(async (category) => {
        const items = await Item.find({
          ItemsGroupCode: category.ItemsGroupCode,
          store: category.store._id
        })
        .select('ItemCode ItemName ItemsGroupCode image imageKey _id')
        .lean();

        const flatCategory = flattenCategory(category);
        flatCategory.items = items.map(i => ({
          _id: i._id,
          ItemCode: i.ItemCode,
          ItemName: i.ItemName,
          ItemsGroupCode: i.ItemsGroupCode,
          image: i.image,
          imageKey: i.imageKey,
        }));
        flatCategory.itemCount = items.length;
        
        return flatCategory;
      })
    );

    res.json({
      success: true,
      count: categoriesWithDetails.length,
      data: categoriesWithDetails
    });
  } catch (error) {
    console.error('Error getting all categories for super admin:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get a single category by ID
const getCategoryById = async (req, res) => {
  try {
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const category = await Category.findOne({ 
      _id: req.params.id, 
      store: storeId 
    })
      .populate('store', 'name');
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    return res.status(200).json({ success: true, data: category });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get category by ItemsGroupCode
const getCategoryByGroupCode = async (req, res) => {
  try {
    const { groupCode } = req.params;
    
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const category = await Category.findOne({ 
      ItemsGroupCode: groupCode,
      store: storeId 
    })
      .populate('store', 'name');
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    return res.status(200).json({ success: true, data: category });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get categories by store ID (now gets from token)
const getCategoriesByStore = async (req, res) => {
  try {
    const { isActive } = req.query;
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    // build category filter
    const filter = { store: storeId };
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    // 1️⃣ find categories
    const categories = await Category.find(filter)
      .populate('store', 'name')
      .lean();

    // 2️⃣ for each category, load & flatten items
    const categoriesWithItems = await Promise.all(
      categories.map(async (cat) => {
        const items = await Item.find({
          ItemsGroupCode: cat.ItemsGroupCode,
          store: storeId
        })
        // pick only these fields, drop _id
        .select('ItemCode ItemName ItemsGroupCode image imageKey _id')
        .lean();

        // flatten each item into a plain POJO
        const flatItems = items.map(i => ({
          _id: i._id,
          ItemCode:         i.ItemCode,
          ItemName:         i.ItemName,
          ItemsGroupCode:   i.ItemsGroupCode,
          image:            i.image,
          imageKey:         i.imageKey,
        }));

        return {
          ...cat,
          items:     flatItems,
          itemCount: flatItems.length
        };
      })
    );

    // 3️⃣ return
    return res.status(200).json({
      success: true,
      count:   categoriesWithItems.length,
      data:    categoriesWithItems
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { name, ItemsGroupCode, isActive } = req.body;
    
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const category = await Category.findOne({ 
      _id: req.params.id, 
      store: storeId 
    });
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Handle image update
    let oldImageKey = null;
    if (req.files && req.files['image'] && req.files['image'][0]) {
      // Save old image key for deletion
      oldImageKey = category.imageKey;
      category.image = req.files['image'][0].location;
      category.imageKey = req.files['image'][0].key;
    }

    // Update fields if provided
    if (name !== undefined) category.name = name;
    if (ItemsGroupCode !== undefined) category.ItemsGroupCode = ItemsGroupCode;
    if (isActive !== undefined) category.isActive = isActive;

    await category.save();

    // Delete old image from S3 if a new one was uploaded
    if (oldImageKey) {
      await deleteS3Object(oldImageKey);
    }

    // Populate the response
    await category.populate('store', 'name');

    return res.status(200).json({ success: true, data: category });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

// Delete a category by ID
const deleteCategory = async (req, res) => {
  try {
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const category = await Category.findOne({ 
      _id: req.params.id, 
      store: storeId 
    });
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Delete image from S3 if exists
    if (category.imageKey) {
      await deleteS3Object(category.imageKey);
    }

    await Category.findByIdAndDelete(req.params.id);
    
    return res.status(200).json({ 
      success: true, 
      message: 'Category and image deleted successfully' 
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Add item to category
const addItemToCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { itemId } = req.body;

    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const category = await Category.findOne({ 
      _id: categoryId, 
      store: storeId 
    });
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Check if item is already in the category
    if (category.items.includes(itemId)) {
      return res.status(400).json({ success: false, message: 'Item already exists in this category' });
    }

    category.items.push(itemId);
    await category.save();

    return res.status(200).json({ 
      success: true, 
      data: category,
      message: 'Item added to category successfully' 
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

// Remove item from category
const removeItemFromCategory = async (req, res) => {
  try {
    const { categoryId, itemId } = req.params;

    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const category = await Category.findOne({ 
      _id: categoryId, 
      store: storeId 
    });
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    category.items = category.items.filter(item => item.toString() !== itemId);
    await category.save();

    return res.status(200).json({ 
      success: true, 
      data: category,
      message: 'Item removed from category successfully' 
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

// Get categories with item counts
const getCategoriesWithItemCounts = async (req, res) => {
  try {
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const pipeline = [
      {
        $match: { store: new mongoose.Types.ObjectId(storeId) }
      },
      {
        $addFields: {
          itemCount: { $size: "$items" }
        }
      },
      {
        $lookup: {
          from: "stores",
          localField: "store",
          foreignField: "_id",
          as: "storeInfo"
        }
      },
      {
        $addFields: {
          store: { $arrayElemAt: ["$storeInfo", 0] }
        }
      },
      {
        $project: {
          storeInfo: 0
        }
      },
      {
        $sort: { ItemsGroupCode: 1 }
      }
    ];

    const categories = await Category.aggregate(pipeline);

    return res.status(200).json({
      success: true,
      count: categories.length,
      data: categories
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Toggle category active status
const toggleCategoryStatus = async (req, res) => {
  try {
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const category = await Category.findOne({ 
      _id: req.params.id, 
      store: storeId 
    });
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    category.isActive = !category.isActive;
    await category.save();

    await category.populate('store', 'name');

    return res.status(200).json({
      success: true,
      message: `Category ${category.isActive ? 'activated' : 'deactivated'} successfully`,
      data: category
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get category statistics by store
const getCategoryStatsByStore = async (req, res) => {
  try {
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const stats = await Category.aggregate([
      {
        $match: { store: new mongoose.Types.ObjectId(storeId) }
      },
      {
        $group: {
          _id: null,
          totalCategories: { $sum: 1 },
          activeCategories: {
            $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] }
          },
          inactiveCategories: {
            $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] }
          },
          totalItems: { $sum: { $size: "$items" } },
          avgItemsPerCategory: { $avg: { $size: "$items" } }
        }
      }
    ]);

    const result = stats.length > 0 ? stats[0] : {
      totalCategories: 0,
      activeCategories: 0,
      inactiveCategories: 0,
      totalItems: 0,
      avgItemsPerCategory: 0
    };

    delete result._id;

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get active categories for a specific store (from token)
const getActiveCategoriesByStore = async (req, res) => {
  try {
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    // Find only active categories for the store
    const categories = await Category.find({ store: storeId, isActive: true })
      .populate('store', 'name')
      .lean();

      const categoriesWithItems = await Promise.all(
        categories.map(async (category) => {
          const items = await Item.find({
            ItemsGroupCode: category.ItemsGroupCode,
            store: storeId
          })
          .select('ItemCode ItemsGroupCode ItemName image imageKey _id')
          .lean();
      
          return {
            ...category,
            items: items.map(i => ({
              _id: i._id,
              ItemCode: i.ItemCode,
              ItemName: i.ItemName,
              ItemsGroupCode: i.ItemsGroupCode,
              image: i.image,
              imageKey: i.imageKey,
            })),
            itemCount: items.length
          };
        })
      );
      

    return res.status(200).json({
      success: true,
      count: categoriesWithItems.length,
      data: categoriesWithItems
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createCategory,
  getAllCategoriesAllStores,
  getCategoryById,
  getCategoryByGroupCode,
  getCategoriesByStore,
  updateCategory,
  deleteCategory,
  addItemToCategory,
  removeItemFromCategory,
  getCategoriesWithItemCounts,
  toggleCategoryStatus,
  getCategoryStatsByStore,
  getActiveCategoriesByStore
};