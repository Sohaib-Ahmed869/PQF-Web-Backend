const Dispute = require('../Models/Dispute');
const SalesOrder = require('../Models/SalesOrder');
const User = require('../Models/User');
const mongoose = require('mongoose');

// Mapping function to convert frontend category values to backend enum values
const mapCategoryToEnum = (frontendCategory) => {
  const categoryMapping = {
    'Wrong item received': 'wrong_item',
    'Damaged item': 'damaged_item',
    'Quality issues': 'product_quality',
    'Delivery problems': 'shipping_delay',
    'Billing issues': 'billing_issue',
    'Other': 'other'
  };
  
  return categoryMapping[frontendCategory] || 'other';
};

// Create a new dispute
const createDispute = async (req, res) => {
  try {
    console.log('Create dispute request body:', req.body);
    console.log('User ID:', req.user._id);
    
    const { orderId, category, description, email } = req.body;
    const userId = req.user._id;

    console.log('Extracted data:', { orderId, category, description, email });

    // Validate required fields
    if (!orderId || !category || !description || !email) {
      console.log('Missing required fields:', { orderId: !!orderId, category: !!category, description: !!description, email: !!email });
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Validate description length
    const trimmedDescription = description.trim();
    if (trimmedDescription.length < 10) {
      console.log('Description too short:', trimmedDescription.length);
      return res.status(400).json({
        success: false,
        message: 'Description must be at least 10 characters long'
      });
    }

    console.log('Looking for order with ID:', orderId);
    // Find the order
    let order = await SalesOrder.findById(orderId);
    console.log('Order found by _id:', !!order);
    
    if (!order) {
      order = await SalesOrder.findOne({ DocNum: orderId });
      console.log('Order found by DocNum:', !!order);
    }
    
    if (!order) {
      console.log('Order not found for ID:', orderId);
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    console.log('Order found:', { orderId: order._id, userId: order.user });

    // Check if user has access to this order
    if (order.user && order.user.toString() !== userId.toString()) {
      console.log('Access denied - order user:', order.user, 'request user:', userId);
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check if active dispute already exists for this order
    const activeDispute = await Dispute.findOne({
      order: order._id,
      user: userId,
      disputeStatus: { $in: ['open', 'in_progress'] }
    });

    if (activeDispute) {
      console.log('Active dispute already exists:', activeDispute._id);
      return res.status(400).json({
        success: false,
        message: 'An active dispute already exists for this order'
      });
    }

    // Map the frontend category to backend enum value
    const mappedCategory = mapCategoryToEnum(category);
    console.log('Category mapping:', { original: category, mapped: mappedCategory });

    // Create new dispute
    const dispute = new Dispute({
      disputeId: new mongoose.Types.ObjectId().toString(),
      order: order._id,
      user: userId,
      disputeCategory: mappedCategory,
      description: trimmedDescription,
      disputeStatus: 'open',
      waitingFor: 'admin',
      needsAdminResponse: true
    });

    await dispute.save();
    console.log('Dispute created successfully:', dispute._id);

    // Populate the dispute with related data
    await dispute.populate([
      { path: 'user', select: 'fullName email' },
      { 
        path: 'order', 
        select: 'DocNum  DocTotal CardName CardCode orderItems shippingAddress billingAddress paymentMethod trackingStatus',
        populate: {
          path: 'store',
          select: 'name address city'
        }
      }
    ]);

    res.status(201).json({
      success: true,
      message: 'Dispute created successfully',
      data: {
        dispute: dispute
      }
    });

  } catch (error) {
    console.error('Error creating dispute:', error);
    
    // Handle validation errors specifically
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create dispute'
    });
  }
};

// Get all disputes for admin
const getAllDisputes = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, category, startDate, endDate } = req.query;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    
    if (status && status !== 'all') {
      filter.disputeStatus = status;
    }
    
    if (category && category !== 'all') {
      filter.disputeCategory = category;
    }
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
    }

    // Get disputes with pagination
    const disputes = await Dispute.find(filter)
      .populate([
        { path: 'user', select: 'fullName email' },
        { 
          path: 'order', 
          select: 'DocNum DocDate DocTotal CardName CardCode orderItems shippingAddress billingAddress paymentMethod trackingStatus',
          populate: {
            path: 'store',
            select: 'name address city'
          }
        }
      ])
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const totalDisputes = await Dispute.countDocuments(filter);

    // Add computed fields
    const disputesWithComputedFields = disputes.map(dispute => {
      const disputeObj = dispute.toObject();
      disputeObj.needsAdminResponse = dispute.waitingFor === 'admin' && dispute.disputeStatus !== 'resolved';
      disputeObj.hasUnreadAdminResponse = dispute.responses.some(response => 
        response.senderType === 'admin' && !response.isRead
      );
      return disputeObj;
    });

    res.json({
      success: true,
      data: {
        disputes: disputesWithComputedFields,
        totalDisputes,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalDisputes / limit),
        itemsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error fetching disputes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch disputes'
    });
  }
};

// Get current user's disputes
const getCurrentUserDisputes = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status, category, startDate, endDate } = req.query;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = { user: userId };
    
    if (status && status !== 'all') {
      filter.disputeStatus = status;
    }
    
    if (category && category !== 'all') {
      filter.disputeCategory = category;
    }
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
    }

    // Get disputes with pagination
    const disputes = await Dispute.find(filter)
      .populate([
        { path: 'user', select: 'fullName email' },
        { 
          path: 'order', 
          select: 'DocNum DocDate DocTotal CardName CardCode orderItems shippingAddress billingAddress paymentMethod trackingStatus',
          populate: {
            path: 'store',
            select: 'name address city'
          }
        }
      ])
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const totalDisputes = await Dispute.countDocuments(filter);

    // Add computed fields
    const disputesWithComputedFields = disputes.map(dispute => {
      const disputeObj = dispute.toObject();
      disputeObj.needsAdminResponse = dispute.waitingFor === 'admin' && dispute.disputeStatus !== 'resolved';
      disputeObj.hasUnreadAdminResponse = dispute.responses.some(response => 
        response.senderType === 'admin' && !response.isRead
      );
      return disputeObj;
    });

    res.json({
      success: true,
      data: {
        disputes: disputesWithComputedFields,
        totalDisputes,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalDisputes / limit),
        itemsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error fetching current user disputes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch disputes'
    });
  }
};

// Get user disputes (for admin or specific user)
const getUserDisputes = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10, status, category, startDate, endDate } = req.query;
    const skip = (page - 1) * limit;

    // Verify user access
    if (req.user.role === 'customer' && req.user._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Build filter object
    const filter = { user: userId };
    
    if (status && status !== 'all') {
      filter.disputeStatus = status;
    }
    
    if (category && category !== 'all') {
      filter.disputeCategory = category;
    }
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
    }

    // Get disputes with pagination
    const disputes = await Dispute.find(filter)
      .populate([
        { path: 'user', select: 'fullName email' },
        { 
          path: 'order', 
          select: 'DocNum DocDate DocTotal CardName CardCode orderItems shippingAddress billingAddress paymentMethod trackingStatus',
          populate: {
            path: 'store',
            select: 'name address city'
          }
        }
      ])
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const totalDisputes = await Dispute.countDocuments(filter);

    // Add computed fields
    const disputesWithComputedFields = disputes.map(dispute => {
      const disputeObj = dispute.toObject();
      disputeObj.needsAdminResponse = dispute.waitingFor === 'admin' && dispute.disputeStatus !== 'resolved';
      disputeObj.hasUnreadAdminResponse = dispute.responses.some(response => 
        response.senderType === 'admin' && !response.isRead
      );
      return disputeObj;
    });

    res.json({
      success: true,
      data: {
        disputes: disputesWithComputedFields,
        totalDisputes,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalDisputes / limit),
        itemsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error fetching user disputes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch disputes'
    });
  }
};

// Get dispute chat history
const getDisputeChat = async (req, res) => {
  try {
    const { disputeId } = req.params;

    const dispute = await Dispute.findOne({ disputeId })
      .populate([
        { path: 'user', select: 'fullName email' },
        { 
          path: 'order', 
          select: 'DocNum DocDate DocTotal CardName CardCode orderItems shippingAddress billingAddress paymentMethod trackingStatus',
          populate: {
            path: 'store',
            select: 'name address city'
          }
        }
      ]);

    if (!dispute) {
      return res.status(404).json({
        success: false,
        message: 'Dispute not found'
      });
    }

    // Check access permissions
    if (req.user.role === 'customer' && dispute.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: {
        dispute: dispute
      }
    });

  } catch (error) {
    console.error('Error fetching dispute chat:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dispute chat'
    });
  }
};

// Send response to dispute
const sendDisputeResponse = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { message, userId, userRole, userName } = req.body;

    if (!message || !userId || !userRole || !userName) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    const dispute = await Dispute.findOne({ disputeId });
    if (!dispute) {
      return res.status(404).json({
        success: false,
        message: 'Dispute not found'
      });
    }

    // Check access permissions
    if (req.user.role === 'customer' && dispute.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Create response object
    const response = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      senderType: userRole,
      senderId: userId,
      senderName: userName,
      message: message.trim(),
      timestamp: new Date()
    };

    // Add response to dispute
    dispute.responses.push(response);
    
    // Update dispute status based on response
    if (dispute.disputeStatus === 'open') {
      dispute.disputeStatus = 'in_progress';
    }

    await dispute.save();

    // Populate the dispute for response
    await dispute.populate([
      { path: 'user', select: 'fullName email' },
      { 
        path: 'order', 
        select: 'DocNum DocDate DocTotal CardName CardCode orderItems shippingAddress billingAddress paymentMethod trackingStatus',
        populate: {
          path: 'store',
          select: 'name address city'
        }
      }
    ]);

    res.json({
      success: true,
      message: 'Response sent successfully',
      data: {
        responseId: response.id,
        disputeStatus: dispute.disputeStatus,
        dispute: dispute
      }
    });

  } catch (error) {
    console.error('Error sending dispute response:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send response'
    });
  }
};

// Update dispute status (admin only)
const updateDisputeStatus = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { disputeStatus } = req.body;

    if (!disputeStatus) {
      return res.status(400).json({
        success: false,
        message: 'Dispute status is required'
      });
    }

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const dispute = await Dispute.findOne({ disputeId });
    if (!dispute) {
      return res.status(404).json({
        success: false,
        message: 'Dispute not found'
      });
    }

    // Update dispute status
    dispute.disputeStatus = disputeStatus;
    
    if (disputeStatus === 'resolved') {
      dispute.resolvedAt = new Date();
    }

    await dispute.save();

    // Populate the dispute for response
    await dispute.populate([
      { path: 'user', select: 'fullName email' },
      { 
        path: 'order', 
        select: 'DocNum DocDate DocTotal CardName CardCode orderItems shippingAddress billingAddress paymentMethod trackingStatus',
        populate: {
          path: 'store',
          select: 'name address city'
        }
      }
    ]);

    res.json({
      success: true,
      message: 'Dispute status updated successfully',
      data: {
        dispute: dispute
      }
    });

  } catch (error) {
    console.error('Error updating dispute status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update dispute status'
    });
  }
};

// Get dispute statistics
const getDisputeStats = async (req, res) => {
  try {
    const stats = await Dispute.aggregate([
      {
        $group: {
          _id: '$disputeStatus',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalDisputes = await Dispute.countDocuments();
    const openDisputes = await Dispute.countDocuments({ disputeStatus: 'open' });
    const inProgressDisputes = await Dispute.countDocuments({ disputeStatus: 'in_progress' });
    const resolvedDisputes = await Dispute.countDocuments({ disputeStatus: 'resolved' });

    res.json({
      success: true,
      data: {
        total: totalDisputes,
        open: openDisputes,
        inProgress: inProgressDisputes,
        resolved: resolvedDisputes,
        breakdown: stats
      }
    });

  } catch (error) {
    console.error('Error fetching dispute stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dispute statistics'
    });
  }
};

module.exports = {
  createDispute,
  getAllDisputes,
  getCurrentUserDisputes,
  getUserDisputes,
  getDisputeChat,
  sendDisputeResponse,
  updateDisputeStatus,
  getDisputeStats
};