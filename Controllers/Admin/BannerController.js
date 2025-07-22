const mongoose=require("mongoose")
const Banner = require('../../Models/Banner');
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

exports.createBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Banner image is required' });
    }

    const { isVisible, bannerType } = req.body;

    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    // Check for unique imagePath and bannerType within the same store
    const existingBanner = await Banner.findOne({ imagePath: req.file.key, store: storeId });
    if (existingBanner) {
      return res.status(400).json({
        success: false,
        message: 'A banner with this image already exists in this store.'
      });
    }
    // Optionally, if you want to prevent duplicate bannerType per store:
    const existingType = await Banner.findOne({ bannerType: bannerType || 'promotional', store: storeId });
    if (existingType) {
      return res.status(400).json({
        success: false,
        message: 'A banner of this type already exists in this store.'
      });
    }

    const banner = new Banner({
      image: req.file.location,
      imagePath: req.file.key,
      imageKey: req.file.key,
      store: storeId,
      isVisible: isVisible !== undefined ? isVisible : true,
      bannerType: bannerType || 'promotional'
    });

    await banner.save();
        
    res.status(201).json({
      success: true,
      message: 'Banner created successfully',
      banner
    });
  } catch (error) {
    console.error('Error creating banner:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get all banners irrespective of store (for admin or global view)
exports.getBanners = async (req, res) => {
  try {
    const { isVisible, bannerType } = req.query;
    const filter = {};
    if (isVisible !== undefined) filter.isVisible = isVisible === 'true';
    if (bannerType) filter.bannerType = bannerType;

    const banners = await Banner.find(filter).populate('store', 'name');
    res.json({
      success: true,
      count: banners.length,
      data: banners
    });
  } catch (error) {
    console.error('Error getting all banners:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.updateBanner = async (req, res) => {
  try {
    const { isVisible, bannerType } = req.body;
    const updateData = {};
    let oldImagePath = null;

    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    // Check if banner exists and belongs to the admin's store
    const existingBanner = await Banner.findOne({ 
      _id: req.params.id, 
      store: storeId 
    });
    
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

    const banner = await Banner.findOneAndUpdate(
      { _id: req.params.id, store: storeId },
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('store', 'name');

    if (!banner) {
      return res.status(404).json({ 
        success: false,
        message: 'Banner not found' 
      });
    }

    // Delete the old image from S3 if a new one was uploaded
    if (oldImagePath) {
      await deleteS3Object(oldImagePath);
    }

    res.json({
      success: true,
      message: 'Banner updated successfully',
      data: banner
    });
  } catch (error) {
    console.error('Error updating banner:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.deleteBanner = async (req, res) => {
  try {
    console.log('DELETE /api/banners/delete/:id called with id:', req.params.id);
    
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const banner = await Banner.findOne({ 
      _id: req.params.id, 
      store: storeId 
    });
    
    console.log('Banner found:', banner);
    
    if (!banner) {
      console.warn('Banner not found for id:', req.params.id);
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
      message: 'Banner deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting banner:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.toggleBannerVisibility = async (req, res) => {
  try {
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const banner = await Banner.findOne({ 
      _id: req.params.id, 
      store: storeId 
    });
    
    if (!banner) {
      return res.status(404).json({ 
        success: false,
        message: 'Banner not found' 
      });
    }

    banner.isVisible = !banner.isVisible;
    await banner.save();

    res.json({
      success: true,
      message: `Banner ${banner.isVisible ? 'shown' : 'hidden'} successfully`,
      data: banner
    });
  } catch (error) {
    console.error('Error toggling banner visibility:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.getBannersByStore = async (req, res) => {
  try {
    const { isVisible, bannerType } = req.query;

    // Get store ID from JWT token instead of route parameter
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const filter = { store: storeId };
    if (isVisible !== undefined) filter.isVisible = isVisible === 'true';
    if (bannerType) filter.bannerType = bannerType;

    const banners = await Banner.find(filter).populate('store', 'name');

    res.json({
      success: true,
      count: banners.length,
      data: banners
    });
  } catch (error) {
    console.error('Error getting banners by store:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get banner by ID (filtered by admin's store)
exports.getBannerById = async (req, res) => {
  try {
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const banner = await Banner.findOne({ 
      _id: req.params.id, 
      store: storeId 
    }).populate('store', 'name');
    
    if (!banner) {
      return res.status(404).json({ 
        success: false,
        message: 'Banner not found' 
      });
    }

    res.json({
      success: true,
      data: banner
    });
  } catch (error) {
    console.error('Error getting banner by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get banner statistics for the admin's store
exports.getBannerStats = async (req, res) => {
  try {
    // Get store ID from JWT token
    const storeId = getStoreIdFromToken(req);
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Store information not found in token' 
      });
    }

    const stats = await Banner.aggregate([
      {
        $match: { store: new mongoose.Types.ObjectId(storeId) }
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
          bannersByType: {
            $push: {
              type: "$bannerType",
              isVisible: "$isVisible"
            }
          }
        }
      }
    ]);

    const result = stats.length > 0 ? stats[0] : {
      totalBanners: 0,
      visibleBanners: 0,
      hiddenBanners: 0,
      bannersByType: []
    };

    delete result._id;

    // Process banner types
    const typeStats = {};
    if (result.bannersByType) {
      result.bannersByType.forEach(banner => {
        if (!typeStats[banner.type]) {
          typeStats[banner.type] = { total: 0, visible: 0, hidden: 0 };
        }
        typeStats[banner.type].total++;
        if (banner.isVisible) {
          typeStats[banner.type].visible++;
        } else {
          typeStats[banner.type].hidden++;
        }
      });
    }

    result.typeStatistics = typeStats;
    delete result.bannersByType;

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting banner stats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};