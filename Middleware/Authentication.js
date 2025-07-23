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
        message: 'No token provided. Access denied.',
        code: 'NO_TOKEN'
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
          message: 'User not found. Token invalid.',
          code: 'INVALID_USER'
        });
      }

      // Check if user is active
      if (user.status !== 'active') {
        return res.status(401).json({
          success: false,
          message: 'User account is inactive. Please contact support.',
          code: 'INACTIVE_USER'
        });
      }

      // For admin users, ensure they have an assigned store
      if (user.role === 'admin' && !user.assignedStore) {
        return res.status(403).json({
          success: false,
          message: 'Admin user must have an assigned store',
          code: 'NO_ASSIGNED_STORE'
        });
      }

      // For admin users, check if assigned store is active
      if (user.role === 'admin' && user.assignedStore && user.assignedStore.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: 'Assigned store is inactive',
          code: 'INACTIVE_STORE'
        });
      }

      // Add user to request object
      req.user = user;
      
      // Add decoded token info for easy access
      req.tokenData = {
        id: decoded.id,
        role: decoded.role,
        assignedStore: decoded.assignedStore,
        iat: decoded.iat,
        exp: decoded.exp
      };

      next();

    } catch (tokenError) {
      console.error('Token verification error:', tokenError);
      
      // Handle specific JWT errors
      if (tokenError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token has expired. Please log in again.',
          code: 'TOKEN_EXPIRED',
          expiredAt: tokenError.expiredAt
        });
      } else if (tokenError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token. Please log in again.',
          code: 'INVALID_TOKEN'
        });
      } else if (tokenError.name === 'NotBeforeError') {
        return res.status(401).json({
          success: false,
          message: 'Token not active yet.',
          code: 'TOKEN_NOT_ACTIVE'
        });
      } else {
        return res.status(401).json({
          success: false,
          message: 'Token verification failed. Please log in again.',
          code: 'TOKEN_VERIFICATION_FAILED'
        });
      }
    }

  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authentication',
      code: 'AUTH_SERVER_ERROR'
    });
  }
};

// Grant access to specific roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${roles.join(', ')}. Current role: ${req.user.role}`,
        code: 'INSUFFICIENT_PERMISSIONS'
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
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  if (req.user.role !== 'superAdmin') {
    return res.status(403).json({
      success: false,
      message: 'Super admin access required',
      code: 'SUPER_ADMIN_REQUIRED'
    });
  }

  next();
};

// Admin or Super admin
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  if (!['admin', 'superAdmin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
      code: 'ADMIN_REQUIRED'
    });
  }

  next();
};

// Store-specific admin access (admin must belong to the store or be super admin)
const requireStoreAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
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
        message: 'Admin must have an assigned store',
        code: 'NO_ASSIGNED_STORE'
      });
    }
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Store admin access required',
    code: 'STORE_ADMIN_REQUIRED'
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
        message: 'Admin user must have an assigned store',
        code: 'NO_ASSIGNED_STORE'
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