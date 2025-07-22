const mongoose = require("mongoose");
const Banner = require('../../Models/Banner');
const { deleteS3Object } = require('../../Config/S3');
const Store = require('../../Models/Store');

// Utility function to flatten banner object
function flattenBanner(banner) {
  const flat = {
    _id: banner._id,
    image: banner.image,
    imagePath: banner.imagePath,
    imageKey: banner.imageKey,
    isVisible: banner.isVisible,
    bannerType: banner.bannerType,
    createdAt: banner.createdAt,
    updatedAt: banner.updatedAt,
    __v: banner.__v,
  };
  if (banner.store) {
    flat.store_id = banner.store._id;
    flat.store_name = banner.store.name;
    if (banner.store.location && banner.store.location.address) {
      const addr = banner.store.location.address;
      flat.store_address_street = addr.street;
      flat.store_address_city = addr.city;
      flat.store_address_state = addr.state;
      flat.store_address_zipCode = addr.zipCode;
      flat.store_address_country = addr.country;
    }
  }
  return flat;
}

// Add banner to any store (for super admin)
exports.addBannerToAnyStore = async (req, res) => {
    try {
      const { storeId, isVisible = true, bannerType } = req.body;
      
      // Set default bannerType if not provided
      const finalBannerType = bannerType || 'promotional';
  

      const storeExists = await Store.findById(storeId);
      if (!storeExists) {
        return res.status(404).json({
          success: false,
          message: 'Store not found'
        });
      }
  
      // Create banner data
      const bannerData = {
        store: storeId,
        image: req.file.location,
        imagePath: req.file.key,
        imageKey: req.file.key,
        isVisible: isVisible === 'true' || isVisible === true,
        bannerType: finalBannerType
      };
  
      // Create new banner
      const newBanner = new Banner(bannerData);
      const savedBanner = await newBanner.save();
  
      // Populate store information for response
      const populatedBanner = await Banner.findById(savedBanner._id)
        .populate('store', 'name location.address');
  
      res.status(201).json({
        success: true,
        message: 'Banner created successfully',
        banner: flattenBanner(populatedBanner)
      });
    } catch (error) {
      console.error('Error creating banner as super admin:', error);
      
      // If there's an error after file upload, clean up the uploaded file
      if (req.file && req.file.key) {
        try {
          await deleteS3Object(req.file.key);
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
// Get all banners from all stores with detailed store information
exports.getAllBannersAllStores = async (req, res) => {
  try {
    const { isVisible, bannerType, storeId, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const filter = {};
    if (isVisible !== undefined) filter.isVisible = isVisible === 'true';
    if (bannerType) filter.bannerType = bannerType;
    if (storeId) filter.store = storeId;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
    const banners = await Banner.find(filter)
      .populate('store', 'name location.address')
      .sort(sortOptions);
    res.json({
      success: true,
      banners: banners.map(flattenBanner)
    });
  } catch (error) {
    console.error('Error getting all banners for super admin:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get banner statistics across all stores
exports.getGlobalBannerStats = async (req, res) => {
  try {
    const stats = await Banner.aggregate([
      {
        $lookup: {
          from: 'stores', // Assuming your stores collection is named 'stores'
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
          totalBanners: { $sum: 1 },
          visibleBanners: {
            $sum: { $cond: [{ $eq: ["$isVisible", true] }, 1, 0] }
          },
          hiddenBanners: {
            $sum: { $cond: [{ $eq: ["$isVisible", false] }, 1, 0] }
          },
          totalStoresWithBanners: {
            $addToSet: "$store"
          },
          bannersByType: {
            $push: {
              type: "$bannerType",
              isVisible: "$isVisible",
              storeName: "$storeInfo.name",
              storeId: "$store"
            }
          }
        }
      },
      {
        $project: {
          totalBanners: 1,
          visibleBanners: 1,
          hiddenBanners: 1,
          totalStoresWithBanners: { $size: "$totalStoresWithBanners" },
          bannersByType: 1
        }
      }
    ]);

    // Get store-wise statistics
    const storeStats = await Banner.aggregate([
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
          _id: "$store",
          storeName: { $first: "$storeInfo.name" },
          storeEmail: { $first: "$storeInfo.email" },
          totalBanners: { $sum: 1 },
          visibleBanners: {
            $sum: { $cond: [{ $eq: ["$isVisible", true] }, 1, 0] }
          },
          hiddenBanners: {
            $sum: { $cond: [{ $eq: ["$isVisible", false] }, 1, 0] }
          },
          bannerTypes: {
            $addToSet: "$bannerType"
          }
        }
      },
      {
        $sort: { totalBanners: -1 }
      }
    ]);

    const result = stats.length > 0 ? stats[0] : {
      totalBanners: 0,
      visibleBanners: 0,
      hiddenBanners: 0,
      totalStoresWithBanners: 0,
      bannersByType: []
    };

    delete result._id;

    // Process banner types globally
    const typeStats = {};
    if (result.bannersByType) {
      result.bannersByType.forEach(banner => {
        if (!typeStats[banner.type]) {
          typeStats[banner.type] = { total: 0, visible: 0, hidden: 0, stores: new Set() };
        }
        typeStats[banner.type].total++;
        typeStats[banner.type].stores.add(banner.storeId.toString());
        if (banner.isVisible) {
          typeStats[banner.type].visible++;
        } else {
          typeStats[banner.type].hidden++;
        }
      });

      // Convert Sets to counts
      Object.keys(typeStats).forEach(type => {
        typeStats[type].storeCount = typeStats[type].stores.size;
        delete typeStats[type].stores;
      });
    }

    result.typeStatistics = typeStats;
    result.storeStatistics = storeStats;
    delete result.bannersByType;

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting global banner stats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get banners by specific store ID (for super admin to view a particular store's banners)
exports.getBannersBySpecificStore = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { isVisible, bannerType } = req.query;

    // Removed: if (!mongoose.Types.ObjectId.isValid(storeId)) { ... 400 ... }

    const filter = { store: storeId };
    if (isVisible !== undefined) filter.isVisible = isVisible === 'true';
    if (bannerType) filter.bannerType = bannerType;

    const banners = await Banner.find(filter)
      .populate('store', 'name location.address');

    res.json({
      success: true,
      banners: banners.map(flattenBanner)
    });
  } catch (error) {
    console.error('Error getting banners by specific store:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Update any banner from any store
exports.updateAnyBanner = async (req, res) => {
  try {
    const { isVisible, bannerType } = req.body;
    const updateData = {};
    let oldImagePath = null;

    const existingBanner = await Banner.findById(req.params.id);
    if (!existingBanner) {
      return res.status(404).json({ 
        success: false,
        message: 'Banner not found' 
      });
    }

    // If new image is uploaded
    if (req.file) {
      oldImagePath = existingBanner.imagePath;
      updateData.image = req.file.location;
      updateData.imagePath = req.file.key;
      updateData.imageKey = req.file.key;
    }

    // Update other fields if provided
    if (isVisible !== undefined) updateData.isVisible = isVisible;
    if (bannerType) updateData.bannerType = bannerType;

    const banner = await Banner.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('store', 'name location.address');

    // Delete the old image from S3 if a new one was uploaded
    if (oldImagePath) {
      await deleteS3Object(oldImagePath);
    }

    res.json({
      success: true,
      banner: flattenBanner(banner)
    });
  } catch (error) {
    console.error('Error updating banner as super admin:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Delete any banner from any store
exports.deleteAnyBanner = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id).populate('store', 'name location.address');
    
    if (!banner) {
      return res.status(404).json({ 
        success: false,
        message: 'Banner not found' 
      });
    }

    // Delete the image from S3
    if (banner.imagePath) {
      await deleteS3Object(banner.imagePath);
    }
    
    // Delete from database
    await Banner.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      banner: flattenBanner(banner)
    });
  } catch (error) {
    console.error('Error deleting banner as super admin:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get any banner by ID from any store
exports.getAnyBannerById = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id)
      .populate('store', 'name location.address');
    
    if (!banner) {
      return res.status(404).json({ 
        success: false,
        message: 'Banner not found' 
      });
    }

    res.json({
      success: true,
      banner: flattenBanner(banner)
    });
  } catch (error) {
    console.error('Error getting banner by ID as super admin:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};