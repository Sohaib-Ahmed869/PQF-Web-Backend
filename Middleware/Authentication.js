const jwt = require('jsonwebtoken');
const User = require('../Models/User');

// Utility: Decode and verify JWT token from request headers
function decodeTokenFromRequest(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key');
    return decoded;
  } catch (error) {
    return null;
  }
}

// Protect routes - Authenticate user
const protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Make sure token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key');
      
      // Get user from the token
      const user = await User.findById(decoded.id).populate('assignedStore', 'name status');
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'No user found with this token'
        });
      }

      // Check if user is active
      if (user.status !== 'active') {
        return res.status(401).json({
          success: false,
          message: 'User account is inactive'
        });
      }

      // For admin users, ensure they have an assigned store
      if (user.role === 'admin' && !user.assignedStore) {
        return res.status(403).json({
          success: false,
          message: 'Admin user must have an assigned store'
        });
      }

      // For admin users, check if assigned store is active
      if (user.role === 'admin' && user.assignedStore && user.assignedStore.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: 'Assigned store is inactive'
        });
      }

      // Add user to request object
      req.user = user;
      
      // Add decoded token info for easy access
      req.tokenData = {
        id: decoded.id,
        role: decoded.role,
        assignedStore: decoded.assignedStore
      };

      next();

    } catch (error) {
      console.error('Token verification error:', error);
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authentication'
    });
  }
};

// Grant access to specific roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`
      });
    }
    
    next();
  };
};

// Super admin only
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  if (req.user.role !== 'superAdmin') {
    return res.status(403).json({
      success: false,
      message: 'Super admin access required'
    });
  }

  next();
};

// Admin or Super admin
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  if (!['admin', 'superAdmin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }

  next();
};

// Store-specific admin access (admin must belong to the store or be super admin)
const requireStoreAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  // Super admin can access any store
  if (req.user.role === 'superAdmin') {
    return next();
  }

  // Admin must have admin role and assigned store
  if (req.user.role === 'admin') {
    if (!req.user.assignedStore) {
      return res.status(403).json({
        success: false,
        message: 'Admin must have an assigned store'
      });
    }
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Store admin access required'
  });
};

// Validate store access for admin users
const validateStoreAccess = (req, res, next) => {
  // Skip validation for super admin
  if (req.user && req.user.role === 'superAdmin') {
    return next();
  }

  // For admin users, ensure they can only access their assigned store data
  if (req.user && req.user.role === 'admin') {
    const userStoreId = req.user.assignedStore?._id?.toString() || req.user.assignedStore?.toString();
    
    if (!userStoreId) {
      return res.status(403).json({
        success: false,
        message: 'Admin user must have an assigned store'
      });
    }

    // Store ID validation will be handled by the controller using JWT token
    return next();
  }

  next();
};

module.exports = {
  protect,
  authorize,
  requireSuperAdmin,
  requireAdmin,
  requireStoreAdmin,
  validateStoreAccess,
  decodeTokenFromRequest
};