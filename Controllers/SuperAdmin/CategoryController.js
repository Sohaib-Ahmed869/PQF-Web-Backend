const mongoose = require("mongoose");
const Category = require('../../Models/Category');
const Item = require('../../Models/Product');
const Store = require('../../Models/Store');
const { deleteS3Object } = require('../../Config/S3');

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
      flat.store_address_street = addr.street;
      flat.store_address_city = addr.city;
      flat.store_address_state = addr.state;
      flat.store_address_zipCode = addr.zipCode;
      flat.store_address_country = addr.country;
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

// Create category for any store (for super admin)
exports.createCategoryForAnyStore = async (req, res) => {
  try {
    const { storeId, name, ItemsGroupCode, isActive = true } = req.body;
    let image = req.body.image;
    let imageKey = '';

    // Verify store exists
    const storeExists = await Store.findById(storeId);
    if (!storeExists) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
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
    } else if (req.file) {
      image = req.file.location;
      imageKey = req.file.key;
    }

    // Create category data
    const categoryData = {
      name,
      ItemsGroupCode,
      image,
      imageKey,
      store: storeId,
      isActive: isActive === 'true' || isActive === true
    };

    // Create new category
    const newCategory = new Category(categoryData);
    const savedCategory = await newCategory.save();

    // Populate store information for response
    const populatedCategory = await Category.findById(savedCategory._id)
      .populate('store', 'name location.address');

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: flattenCategory(populatedCategory)
    });
  } catch (error) {
    console.error('Error creating category as super admin:', error);
    
    // If there's an error after file upload, clean up the uploaded file
    if (req.file && req.file.key) {
      try {
        await deleteS3Object(req.file.key);
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded file:', cleanupError);
      }
    }
    if (req.files && req.files['image'] && req.files['image'][0]) {
      try {
        await deleteS3Object(req.files['image'][0].key);
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded file:', cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get all categories from all stores with detailed store information
exports.getAllCategoriesAllStores = async (req, res) => {
  try {
    const { isActive, storeId, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const filter = {};
    
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (storeId) filter.store = storeId;
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
    
    const categories = await Category.find(filter)
      .populate('store', 'name location.address')
      .sort(sortOptions);

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

// Get category statistics across all stores
exports.getGlobalCategoryStats = async (req, res) => {
  try {
    const stats = await Category.aggregate([
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
        $lookup: {
          from: 'products',
          let: { groupCode: '$ItemsGroupCode', storeId: '$store' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$ItemsGroupCode', '$groupCode'] },
                    { $eq: ['$store', '$storeId'] }
                  ]
                }
              }
            }
          ],
          as: 'items'
        }
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
          totalStoresWithCategories: {
            $addToSet: "$store"
          },
          categoriesByStore: {
            $push: {
              isActive: "$isActive",
              storeName: "$storeInfo.name",
              storeId: "$store",
              itemsCount: { $size: "$items" }
            }
          }
        }
      },
      {
        $project: {
          totalCategories: 1,
          activeCategories: 1,
          inactiveCategories: 1,
          totalStoresWithCategories: { $size: "$totalStoresWithCategories" },
          categoriesByStore: 1
        }
      }
    ]);

    // Get the total number of products (items) in the products collection
    const Item = require('../../Models/Product');
    const totalItems = await Item.countDocuments();

    // Get store-wise statistics
    const storeStats = await Store.aggregate([
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: 'store',
          as: 'categories'
        }
      },
      {
        $lookup: {
          from: 'items',
          localField: '_id',
          foreignField: 'store',
          as: 'items'
        }
      },
      {
        $project: {
          _id: 1,
          storeName: '$name',
          storeEmail: '$email',
          totalCategories: { $size: '$categories' },
          activeCategories: {
            $size: {
              $filter: {
                input: '$categories',
                as: 'cat',
                cond: { $eq: ['$$cat.isActive', true] }
              }
            }
          },
          inactiveCategories: {
            $size: {
              $filter: {
                input: '$categories',
                as: 'cat',
                cond: { $eq: ['$$cat.isActive', false] }
              }
            }
          },
          totalItems: { $size: '$items' },
          avgItemsPerCategory: {
            $cond: [
              { $eq: [{ $size: '$categories' }, 0] },
              0,
              { $divide: [{ $size: '$items' }, { $size: '$categories' }] }
            ]
          }
        }
      },
      { $sort: { totalCategories: -1 } }
    ]);

    const result = stats.length > 0 ? stats[0] : {
      totalCategories: 0,
      activeCategories: 0,
      inactiveCategories: 0,
      totalStoresWithCategories: 0,
      categoriesByStore: []
    };

    delete result._id;
    result.storeStatistics = storeStats;
    delete result.categoriesByStore;

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting global category stats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get categories by specific store ID (for super admin to view a particular store's categories)
exports.getCategoriesBySpecificStore = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { isActive } = req.query;

    const filter = { store: storeId };
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const categories = await Category.find(filter)
      .populate('store', 'name location.address')
      .lean();

    // Load items for each category
    const categoriesWithItems = await Promise.all(
      categories.map(async (category) => {
        const items = await Item.find({
          ItemsGroupCode: category.ItemsGroupCode,
          store: storeId
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
      count: categoriesWithItems.length,
      data: categoriesWithItems
    });
  } catch (error) {
    console.error('Error getting categories by specific store:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Update any category from any store
exports.updateAnyCategory = async (req, res) => {
  try {
    const { name, ItemsGroupCode, isActive } = req.body;
    const updateData = {};
    let oldImageKey = null;

    const existingCategory = await Category.findById(req.params.id);
    if (!existingCategory) {
      return res.status(404).json({ 
        success: false,
        message: 'Category not found' 
      });
    }

    // Check for unique name and ItemsGroupCode if they're being updated
    if (name && name !== existingCategory.name) {
      const existingName = await Category.findOne({ 
        name, 
        store: existingCategory.store,
        _id: { $ne: req.params.id }
      });
      if (existingName) {
        return res.status(400).json({
          success: false,
          message: 'Category name already exists in this store.'
        });
      }
      updateData.name = name;
    }

    if (ItemsGroupCode && ItemsGroupCode !== existingCategory.ItemsGroupCode) {
      const existingGroupCode = await Category.findOne({ 
        ItemsGroupCode, 
        store: existingCategory.store,
        _id: { $ne: req.params.id }
      });
      if (existingGroupCode) {
        return res.status(400).json({
          success: false,
          message: 'Category group code already exists in this store.'
        });
      }
      updateData.ItemsGroupCode = ItemsGroupCode;
    }

    // Handle image update
    if (req.files && req.files['image'] && req.files['image'][0]) {
      oldImageKey = existingCategory.imageKey;
      updateData.image = req.files['image'][0].location;
      updateData.imageKey = req.files['image'][0].key;
    } else if (req.file) {
      oldImageKey = existingCategory.imageKey;
      updateData.image = req.file.location;
      updateData.imageKey = req.file.key;
    }

    // Update other fields if provided
    if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('store', 'name location.address');

    // Delete the old image from S3 if a new one was uploaded
    if (oldImageKey) {
      await deleteS3Object(oldImageKey);
    }

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: flattenCategory(category)
    });
  } catch (error) {
    console.error('Error updating category as super admin:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Delete any category from any store
exports.deleteAnyCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('store', 'name location.address');
    
    if (!category) {
      return res.status(404).json({ 
        success: false,
        message: 'Category not found' 
      });
    }

    // Delete the image from S3 if exists
    if (category.imageKey) {
      await deleteS3Object(category.imageKey);
    }
    
    // Delete from database
    await Category.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Category deleted successfully',
      data: flattenCategory(category)
    });
  } catch (error) {
    console.error('Error deleting category as super admin:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get any category by ID from any store
exports.getAnyCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('store', 'name location.address');
    
    if (!category) {
      return res.status(404).json({ 
        success: false,
        message: 'Category not found' 
      });
    }

    // Load items from Item collection based on ItemsGroupCode
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

    res.json({
      success: true,
      data: flatCategory
    });
  } catch (error) {
    console.error('Error getting category by ID as super admin:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
