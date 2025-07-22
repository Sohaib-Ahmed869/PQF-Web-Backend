const Store = require('../../Models/Store');
const User = require('../../Models/User');

const createStore = async (req, res) => {
  try {
    const storeData = {
      ...req.body,
      createdBy: req.user._id
    };

    const store = await Store.create(storeData);
    res.status(201).json({
      success: true,
      message: 'Store created successfully',
      data: store
    });

  } catch (error) {
    console.error('Create store error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating store',
      error: error.message
    });
  }
};
const getAllStores = async (req, res) => {
    try {
      const { page = 1, limit = 50, status, search, country, city } = req.query;
  
      let query = {};
  
      // Role-based filtering
      if (req.user.role === 'admin') {
        // Admin can only see their assigned store
        query._id = req.user.assignedStore;
      } else if (req.user.role === 'customer') {
        // Customers can only see active stores
        query.status = 'active';
      }
  
      // Super-admin can filter by status
      if (status && req.user.role === 'superAdmin') {
        query.status = status;
      }
  
      // Search across name, description, city, country
      if (search) {
        query.$or = [
          { name:                   { $regex: search, $options: 'i' } },
          { description:            { $regex: search, $options: 'i' } },
          { 'location.address.city':    { $regex: search, $options: 'i' } },
          { 'location.address.country': { $regex: search, $options: 'i' } }
        ];
      }
  
      // Specific country / city filters
      if (country) {
        query['location.address.country'] = { $regex: country, $options: 'i' };
      }
      if (city) {
        query['location.address.city'] = { $regex: city, $options: 'i' };
      }
  
      // Fetch and paginate
      const stores = await Store.find(query)
        .populate('storeManager', 'name email')
        .populate('admins',       'name email')
        .populate('createdBy',    'name email')
        .limit(+limit)
        .skip((page - 1) * limit)
        .sort({ createdAt: -1 });
  
      const total = await Store.countDocuments(query);
  
      // Flattened JSON response
      return res.status(200).json({
        success: true,
        stores,
        pagination: {
          current: +page,
          pages:   Math.ceil(total / limit),
          total
        }
      });
  
    } catch (error) {
      console.error('Get all stores error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error while fetching stores',
        error:   error.message
      });
    }
  };
  

const getStoreById = async (req, res) => {
  try {
    let query = { _id: req.params.id };

    // Role-based access control
    if (req.user.role === 'admin') {
      // Admin can only access their assigned store
      if (req.user.assignedStore.toString() !== req.params.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only access your assigned store.'
        });
      }
    } else if (req.user.role === 'customer') {
      // Customers can only see active stores
      query.status = 'active';
    }

    const store = await Store.findOne(query)
      .populate('storeManager', 'name email phone')
      .populate('admins', 'name email phone')
      .populate('createdBy', 'name email');

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    res.status(200).json({
      success: true,
      data: store
    });

  } catch (error) {
    console.error('Get store by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching store',
      error: error.message
    });
  }
};

const updateStore = async (req, res) => {
  try {
    let query = { _id: req.params.id };

    // Role-based access control
    if (req.user.role === 'admin') {
      // Admin can only update their assigned store
      if (req.user.assignedStore.toString() !== req.params.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update your assigned store.'
        });
      }
      
      // Remove fields that admins can't update
      const restrictedFields = ['createdBy', 'storeManager', 'admins', 'status'];
      restrictedFields.forEach(field => delete req.body[field]);
    }

    const store = await Store.findOneAndUpdate(
      query,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('storeManager', 'name email')
      .populate('admins', 'name email')
      .populate('createdBy', 'name email');

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Store updated successfully',
      data: store
    });

  } catch (error) {
    console.error('Update store error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating store',
      error: error.message
    });
  }
};

const updateStoreStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['active', 'inactive', 'maintenance', 'closed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const store = await Store.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    )
      .populate('storeManager', 'name email')
      .populate('admins', 'name email');

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Store status updated successfully',
      data: store
    });

  } catch (error) {
    console.error('Update store status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating store status',
      error: error.message
    });
  }
};

const deleteStore = async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    // Remove store assignment from all admins
    await User.updateMany(
      { assignedStore: req.params.id },
      { $unset: { assignedStore: 1 } }
    );

    await Store.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Store deleted successfully'
    });

  } catch (error) {
    console.error('Delete store error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting store',
      error: error.message
    });
  }
};


const assignAdminToStore = async (req, res) => {
  try {
    const { adminId } = req.body;

    // Validate admin user
    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin user not found'
      });
    }

    if (admin.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'User must have admin role'
      });
    }

    // Update admin's assigned store
    admin.assignedStore = req.params.id;
    await admin.save();

    // Update store's admin list
    const store = await Store.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { admins: adminId } },
      { new: true }
    )
      .populate('admins', 'name email')
      .populate('storeManager', 'name email');

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Admin assigned to store successfully',
      data: store
    });

  } catch (error) {
    console.error('Assign admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while assigning admin',
      error: error.message
    });
  }
};

const removeAdminFromStore = async (req, res) => {
  try {
    const { adminId } = req.body;

    // Update admin's assigned store
    await User.findByIdAndUpdate(
      adminId,
      { $unset: { assignedStore: 1 } }
    );

    // Update store's admin list
    const store = await Store.findByIdAndUpdate(
      req.params.id,
      { $pull: { admins: adminId } },
      { new: true }
    )
      .populate('admins', 'name email')
      .populate('storeManager', 'name email');

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Admin removed from store successfully',
      data: store
    });

  } catch (error) {
    console.error('Remove admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing admin',
      error: error.message
    });
  }
};

const getStoresByLocation = async (req, res) => {
  try {
    const { latitude, longitude, maxDistance = 10000 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const stores = await Store.findByLocation(
      parseFloat(latitude),
      parseFloat(longitude),
      parseInt(maxDistance)
    )
      .populate('storeManager', 'name email')
      .select('-admins -createdBy');

    res.status(200).json({
      success: true,
      data: stores
    });

  } catch (error) {
    console.error('Get stores by location error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching nearby stores',
      error: error.message
    });
  }
};

const getStoreStats = async (req, res) => {
  try {
    let query = { _id: req.params.id };

    // Role-based access control
    if (req.user.role === 'admin') {
      if (req.user.assignedStore.toString() !== req.params.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only access your assigned store.'
        });
      }
    }

    const store = await Store.findOne(query);

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    // Basic stats - you can expand this with actual business logic
    const stats = {
      storeInfo: {
        name: store.name,
        status: store.status,
        isCurrentlyOpen: store.isCurrentlyOpen()
      },
      adminCount: store.admins.length,
      features: store.features,
      lastUpdated: store.updatedAt
    };

    res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get store stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching store statistics',
      error: error.message
    });
  }
};

module.exports = {
  createStore,
  getAllStores,
  getStoreById,
  updateStore,
  updateStoreStatus,
  deleteStore,
  assignAdminToStore,
  removeAdminFromStore,
  getStoresByLocation,
  getStoreStats
};