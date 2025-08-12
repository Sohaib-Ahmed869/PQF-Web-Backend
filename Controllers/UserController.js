const User = require('../Models/User');
const Store = require('../Models/Store');
const Customer = require('../Models/Customer');
const Item = require('../Models/Product'); // The schema file is Product.js but the model is now 'Item'

const jwt = require('jsonwebtoken');

// Helper function to generate JWT token
const generateToken = (user) => {
  let assignedStoreId = null;
  if (user.assignedStore) {
    if (typeof user.assignedStore === 'object' && user.assignedStore._id) {
      assignedStoreId = user.assignedStore._id.toString();
    } else {
      assignedStoreId = user.assignedStore.toString();
    }
  }
  return jwt.sign(
    { 
      id: user._id.toString(),
      role: user.role,
      assignedStore: assignedStoreId
    },
    process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    { expiresIn: '30d' }
  );
};

// CUSTOMER REGISTRATION - Single step for customers
const registerCustomer = async (req, res) => {
  try {
    const { 
      name, 
      email, 
      password, 
      phone, 
      agreeToTerms, 
      agreeToPrivacy 
    } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Validate required fields
    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Validate phone number
    if (!phone || phone.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid phone number'
      });
    }

    // Validate terms agreement
    if (!agreeToTerms || !agreeToPrivacy) {
      return res.status(400).json({
        success: false,
        message: 'You must agree to both Terms and Conditions and Privacy Policy to register'
      });
    }

    const userData = {
      name,
      email,
      password,
      phone,
      role: 'customer',
      registrationType: 'customer',
      registrationStep: 'completed',
      termsAndConditions: {
        agreed: true,
        agreedAt: new Date(),
        version: '1.0'
      },
      privacyPolicy: {
        agreed: true,
        agreedAt: new Date(),
        version: '1.0'
      },
      documentVerificationStatus: 'verified' // Customers don't need document verification
    };

    const user = await User.create(userData);

    // Create Customer document and link
    const customerDoc = new Customer({
      CardName: name,
      Email: email,
      phoneNumber: phone,
      user: user._id,
      customerType: 'non-sap',
      status: 'active',
    });
    await customerDoc.save();
    
    user.customer = customerDoc._id;
    await user.save();

    // Generate token for completed registration
    const token = generateToken(user);
    user.password = undefined;

    return res.status(201).json({
      success: true,
      message: 'Customer registration completed successfully!',
      user,
      token
    });

  } catch (error) {
    console.error('Customer registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during customer registration',
      error: error.message
    });
  }
};

// BUSINESS REGISTRATION - Single API call with everything
const registerBusiness = async (req, res) => {
  try {
    const { 
      name, 
      email, 
      password, 
      phone, 
      agreeToTerms, 
      agreeToPrivacy
    } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Validate required fields
    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields (name, email, password, phone)'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Validate phone number
    if (!phone || phone.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid phone number'
      });
    }

    // Validate required documents
    if (!req.files || !req.files.tradeLicense || !req.files.tradeLicense[0]) {
      return res.status(400).json({
        success: false,
        message: 'Trade License is required for business registration'
      });
    }
    
    if (!req.files.idDocument || !req.files.idDocument[0]) {
      return res.status(400).json({
        success: false,
        message: 'ID Document is required for business registration'
      });
    }

    // Validate terms agreement
    if (!agreeToTerms || !agreeToPrivacy) {
      return res.status(400).json({
        success: false,
        message: 'You must agree to both Terms and Conditions and Privacy Policy to register'
      });
    }

    // Prepare documents object
    let documents = {};
    
    // Process mandatory documents
    documents.tradeLicense = {
      url: req.files.tradeLicense[0].location,
      filename: req.files.tradeLicense[0].originalname,
      uploadedAt: new Date(),
      verified: false,
      required: true
    };
    
    documents.idDocument = {
      url: req.files.idDocument[0].location,
      filename: req.files.idDocument[0].originalname,
      uploadedAt: new Date(),
      verified: false,
      required: true
    };

    // Process optional bank statement if provided
    if (req.files.bankStatement && req.files.bankStatement.length > 0) {
      console.log('Processing bank statements:', req.files.bankStatement.length, 'files');
      console.log('Bank statement months from body:', req.body.bankStatementMonth);
      
      if (req.files.bankStatement.length > 1) {
        // Multiple monthly statements
        documents.bankStatements = req.files.bankStatement.map((file, index) => {
          // Get the corresponding month from the request body
          let month = `month_${index + 1}`;
          if (req.body.bankStatementMonth && Array.isArray(req.body.bankStatementMonth)) {
            month = req.body.bankStatementMonth[index] || `month_${index + 1}`;
          }
          
          console.log(`Processing bank statement ${index + 1}: month=${month}, filename=${file.originalname}`);
          
          return {
            url: file.location,
            filename: file.originalname,
            uploadedAt: new Date(),
            verified: false,
            required: false,
            month: month
          };
        });
        console.log('Created bankStatements array:', documents.bankStatements.length, 'items');
      } else {
        // Single 6-month statement
        documents.bankStatement = {
          url: req.files.bankStatement[0].location,
          filename: req.files.bankStatement[0].originalname,
          uploadedAt: new Date(),
          verified: false,
          required: false
        };
        console.log('Created single bankStatement:', documents.bankStatement.filename);
      }
    }

    // Create user data
    const userData = {
      name,
      email,
      password,
      phone,
      role: 'customer',
      registrationType: 'business',
      registrationStep: 'completed',
      documentVerificationStatus: 'pending',
      documents,
      termsAndConditions: {
        agreed: agreeToTerms,
        agreedAt: new Date(),
        version: '1.0'
      },
      privacyPolicy: {
        agreed: agreeToPrivacy,
        agreedAt: new Date(),
        version: '1.0'
      }
    };

    // Create user
    const user = await User.create(userData);

    // Create Customer document and link
    const customerDoc = new Customer({
      CardName: name,
      Email: email,
      phoneNumber: phone,
      user: user._id,
      customerType: 'non-sap',
      status: 'active',
    });
    await customerDoc.save();
    
    user.customer = customerDoc._id;
    await user.save();

    // Generate token for completed registration
    const token = generateToken(user);
    user.password = undefined;

    return res.status(201).json({
      success: true,
      message: 'Business registration completed successfully! Please wait for document verification.',
      user,
      token
    });

  } catch (error) {
    console.error('Business registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during business registration',
      error: error.message
    });
  }
};

// ADMIN CREATION - By Super Admin only
const createAdmin = async (req, res) => {
  try {
    const { 
      name, 
      email, 
      password, 
      assignedStore, 
      phone, 
      agreeToTerms, 
      agreeToPrivacy 
    } = req.body;

    // Check authorization
    if (!req.user || req.user.role !== 'superAdmin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admin can create admin users'
      });
    }

    // Validate required fields
    if (!name || !email || !password || !assignedStore) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, password, and assigned store are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Validate store exists
    const store = await Store.findById(assignedStore);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Assigned store not found'
      });
    }

    // Validate terms agreement
    if (!agreeToTerms || !agreeToPrivacy) {
      return res.status(400).json({
        success: false,
        message: 'You must agree to both Terms and Conditions and Privacy Policy to register'
      });
    }

    const userData = {
      name,
      email,
      password,
      phone,
      role: 'admin',
      registrationType: 'business',
      assignedStore,
      createdBy: req.user._id,
      termsAndConditions: {
        agreed: agreeToTerms,
        agreedAt: new Date(),
        version: '1.0'
      },
      privacyPolicy: {
        agreed: agreeToPrivacy,
        agreedAt: new Date(),
        version: '1.0'
      },
      registrationStep: 'completed',
      documentVerificationStatus: 'verified'
    };

    const user = await User.create(userData);
    
    // Add admin to store
    await Store.findByIdAndUpdate(assignedStore, { 
      $addToSet: { admins: user._id } 
    });

    const token = generateToken(user);
    user.password = undefined;

    return res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      user,
      token
    });

  } catch (error) {
    console.error('Admin creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during admin creation',
      error: error.message
    });
  }
};

// SUPER ADMIN REGISTRATION
const registerSuperAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }

    // Check if this is the first super admin or if current user is super admin
    const superAdminCount = await User.countDocuments({ role: 'superAdmin' });
    
    if (superAdminCount === 0) {
      // First super admin registration
      const user = await User.create({ 
        name, 
        email, 
        password, 
        role: 'superAdmin',
        registrationType: 'business',
        registrationStep: 'completed',
        documentVerificationStatus: 'verified'
      });
      
      const token = generateToken(user);
      user.password = undefined;
      
      return res.status(201).json({
        success: true,
        message: 'Super admin registered successfully',
        user,
        token
      });
    } else {
      // Additional super admin creation by existing super admin
      if (!req.user || req.user.role !== 'superAdmin') {
        return res.status(403).json({
          success: false,
          message: 'Only an existing super admin can create another super admin'
        });
      }
      
      const user = await User.create({ 
        name, 
        email, 
        password, 
        role: 'superAdmin', 
        registrationType: 'business',
        createdBy: req.user._id,
        registrationStep: 'completed',
        documentVerificationStatus: 'verified'
      });
      
      const token = generateToken(user);
      user.password = undefined;
      
      return res.status(201).json({
        success: true,
        message: 'Super admin registered successfully',
        user,
        token
      });
    }

  } catch (error) {
    console.error('Super admin registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during super admin registration',
      error: error.message
    });
  }
};

// LOGIN FUNCTION
const login = async (req, res) => {
  try {
    // Ensure req.body exists and is an object
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: missing body.'
      });
    }
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Check for user and include password
    const user = await User.findOne({ email }).select('+password').populate('assignedStore', 'name location');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Account is inactive. Please contact administrator.'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user);

    user.password = undefined;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: error.message
    });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('assignedStore', 'name location');
    
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile',
      error: error.message
    });
  }
};

const updateProfile = async (req, res) => {
    try {
      // 1) define exactly what _can_ change
      const allowedFields = [
        'name',
        'phone',
        'dateOfBirth',
        'gender',
        'addresses'
      ];
      const attempted = Object.keys(req.body);
  
      // 2) reject if any un-allowed field is in the payload
      const invalid = attempted.filter(f => !allowedFields.includes(f));
      if (invalid.length) {
        return res.status(400).json({
          success: false,
          message: `Invalid update fields: ${invalid.join(', ')}`
        });
      }
  
      // 3) load the user document, apply only the allowed updates, then save
      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
  
      attempted.forEach(field => {
        user[field] = req.body[field];
      });
  
      // this will run schema validators, pre-save hooks, etc.
      const updated = await user.save();
  
      // 4) populate any refs and send back
      await updated.populate('assignedStore', 'name location');
  
      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: updated
      });
  
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while updating profile',
        error: error.message
      });
    }
  };

const getAllUsers = async (req, res) => {
    try {
      const { page = 1, limit = 10, status, search } = req.query;
  
      // 1) build your query, always excluding superAdmins
      const query = { role: { $ne: 'superAdmin' } };
      if (status) query.status = status;
      if (search) {
        query.$or = [
          { name:    { $regex: search, $options: 'i' } },
          { email:   { $regex: search, $options: 'i' } }
        ];
      }
  
      // 2) fetch & paginate
      const users = await User.find(query)
        .populate('assignedStore', 'name location')
        .populate('createdBy',    'name email')
        .select('-password')
        .limit(+limit)
        .skip((page - 1) * limit)
        .sort({ createdAt: -1 });
  
      const total = await User.countDocuments(query);
  
      // 3) send a flattened response
      return res.status(200).json({
        success: true,
        users,                                  // ← now at top level
        pagination: {
          current: +page,
          pages:   Math.ceil(total / limit),
          total
        }
      });
  
    } catch (error) {
      console.error('Get all users error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching users',
        error:   error.message
      });
    }
  };
  

  const getUserById = async (req, res) => {
    try {
      const user = await User.findById(req.params.id)
        .populate('assignedStore', 'name location')
        .populate('createdBy',    'name email')
        .select('-password');
  
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
  
      // ——— Flattened response:
      return res.status(200).json({
        success: true,
        user
      });
  
    } catch (error) {
      console.error('Get user by ID error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error while fetching user',
        error:   error.message
      });
    }
  };

const updateUserStatus = async (req, res) => {
  try {
    // Ensure req.body exists and is an object
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: missing body.'
      });
    }
    const { status } = req.body;
    
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).populate('assignedStore', 'name location');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User status updated successfully',
      data: user
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user status',
      error: error.message
    });
  }
};

const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Don't allow deletion of super admin
    if (user.role === 'superAdmin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete super admin user'
      });
    }

    // Remove admin from store if applicable
    if (user.role === 'admin' && user.assignedStore) {
      await Store.findByIdAndUpdate(
        user.assignedStore,
        { $pull: { admins: user._id } }
      );
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting user',
      error: error.message
    });
  }
};

const updateTermsAgreement = async (req, res) => {
  try {
    const { agreeToTerms, agreeToPrivacy } = req.body;
    
    if (!agreeToTerms || !agreeToPrivacy) {
      return res.status(400).json({
        success: false,
        message: 'You must agree to both Terms and Conditions and Privacy Policy'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        termsAndConditions: {
          agreed: agreeToTerms,
          agreedAt: new Date(),
          version: '1.0'
        },
        privacyPolicy: {
          agreed: agreeToPrivacy,
          agreedAt: new Date(),
          version: '1.0'
        }
      },
      { new: true, runValidators: true }
    ).populate('assignedStore', 'name location');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Terms and conditions agreement updated successfully',
      data: user
    });

  } catch (error) {
    console.error('Update terms agreement error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating terms agreement',
      error: error.message
    });
  }
};

const getAdmins = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const query = { role: 'admin' };
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    const admins = await User.find(query)
      .populate('assignedStore', 'name location')
      .populate('createdBy', 'name email')
      .select('-password')
      .limit(+limit)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    const total = await User.countDocuments(query);
    return res.status(200).json({
      success: true,
      admins,
      pagination: {
        current: +page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching admins',
      error: error.message
    });
  }
};

// Update document verification status (for admin use)
const updateDocumentVerification = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, notes } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.documentVerificationStatus = status;
    if (notes) {
      user.documentVerificationNotes = notes;
    }

    // Update verification status for individual documents
    if (status === 'verified') {
      if (user.documents.tradeLicense) {
        user.documents.tradeLicense.verified = true;
      }
      if (user.documents.idDocument) {
        user.documents.idDocument.verified = true;
      }
      // Handle monthly bank statements
      if (user.documents.bankStatements && user.documents.bankStatements.length > 0) {
        user.documents.bankStatements.forEach(statement => {
          statement.verified = true;
        });
      }
      // Handle single bank statement
      if (user.documents.bankStatement) {
        user.documents.bankStatement.verified = true;
      }
    }

    await user.save();

    res.json({
      success: true,
      message: 'Document verification status updated successfully',
      data: {
        documentVerificationStatus: user.documentVerificationStatus,
        documentVerificationNotes: user.documentVerificationNotes
      }
    });

  } catch (error) {
    console.error('Document verification update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during document verification update',
      error: error.message
    });
  }
};

// Add a new address
const addAddress = async (req, res) => {
  try {
    const { name, street, city, state, zipCode, country, setAsShipping, setAsBilling, setBoth } = req.body;
    if (!name || !street || !city || !country) {
      return res.status(400).json({ success: false, message: 'Missing required address fields' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const newAddress = {
      _id: new (require('mongoose').Types.ObjectId)(),
      name, street, city, state, zipCode, country
    };
    user.addresses.push(newAddress);
    // Optionally set as shipping/billing/both
    let shippingAddressChanged = false;
    if (setBoth) {
      user.shippingAddress = newAddress._id;
      user.billingAddress = newAddress._id;
      shippingAddressChanged = true;
    } else {
      if (setAsShipping) {
        user.shippingAddress = newAddress._id;
        shippingAddressChanged = true;
      }
      if (setAsBilling) user.billingAddress = newAddress._id;
    }
    await user.save();
    // Update Customer.address if shipping address changed and user is a customer
    if (shippingAddressChanged && user.customer) {
      await Customer.findByIdAndUpdate(
        user.customer,
        { address: {
            street: newAddress.street,
            zipCode: newAddress.zipCode,
            city: newAddress.city,
            country: newAddress.country
          }
        }
      );
    }
    res.status(201).json({ success: true, message: 'Address added', addresses: user.addresses, shippingAddress: user.shippingAddress, billingAddress: user.billingAddress });
  } catch (error) {
    console.error('Add address error:', error);
    res.status(500).json({ success: false, message: 'Server error while adding address', error: error.message });
  }
};

// Update an existing address
const updateAddress = async (req, res) => {
  try {
    // Ensure req.body exists and is an object
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: missing body.'
      });
    }
    const { addressId } = req.params;
    const { name, street, city, state, zipCode, country, setAsShipping, setAsBilling, setBoth } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const address = user.addresses.id(addressId);
    if (!address) return res.status(404).json({ success: false, message: 'Address not found' });
    if (name !== undefined) address.name = name;
    if (street !== undefined) address.street = street;
    if (city !== undefined) address.city = city;
    if (state !== undefined) address.state = state;
    if (zipCode !== undefined) address.zipCode = zipCode;
    if (country !== undefined) address.country = country;

    // Optionally set as shipping/billing/both
    let shippingAddressChanged = false;
    if (setBoth) {
      user.shippingAddress = address._id;
      user.billingAddress = address._id;
      shippingAddressChanged = true;
    } else {
      // Shipping
      if (typeof setAsShipping !== 'undefined') {
        if (setAsShipping) {
          user.shippingAddress = address._id;
          shippingAddressChanged = true;
        } else if (user.shippingAddress && user.shippingAddress.toString() === address._id.toString()) {
          user.shippingAddress = null;
          shippingAddressChanged = true;
        }
      }
      // Billing
      if (typeof setAsBilling !== 'undefined') {
        if (setAsBilling) {
          user.billingAddress = address._id;
        } else if (user.billingAddress && user.billingAddress.toString() === address._id.toString()) {
          user.billingAddress = null;
        }
      }
    }
    await user.save();
    // If this address is the shipping address, update Customer.address
    if (
      user.customer &&
      user.shippingAddress &&
      user.shippingAddress.toString() === addressId
    ) {
      await Customer.findByIdAndUpdate(
        user.customer,
        {
          address: {
            street: address.street,
            zipCode: address.zipCode,
            city: address.city,
            country: address.country
          }
        }
      );
    }
    res.status(200).json({
      success: true,
      message: 'Address updated',
      addresses: user.addresses,
      shippingAddress: user.shippingAddress,
      billingAddress: user.billingAddress
    });
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating address', error: error.message });
  }
};

// Delete an address
const deleteAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const address = user.addresses.id(addressId);
    if (!address) return res.status(404).json({ success: false, message: 'Address not found' });
    // Remove address
    user.addresses.pull(addressId);
    // Unset shipping/billing if this address was set
    let removedShipping = false;
    if (user.shippingAddress && user.shippingAddress.toString() === addressId) {
      user.shippingAddress = null;
      removedShipping = true;
    }
    if (user.billingAddress && user.billingAddress.toString() === addressId) user.billingAddress = null;
    await user.save();
    // If the removed address was the shipping address and user is a customer, unset address in Customer
    if (removedShipping && user.customer) {
      await Customer.findByIdAndUpdate(
        user.customer,
        { $unset: { address: "" } }
      );
    }
    res.status(200).json({ success: true, message: 'Address deleted', addresses: user.addresses });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting address', error: error.message });
  }
};

// Set default shipping or billing address
const setDefaultAddress = async (req, res) => {
  try {
    const { addressId } = req.body;
    const { type } = req.params; // 'shipping' or 'billing'
    if (!['shipping', 'billing'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid address type' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const address = user.addresses.id(addressId);
    if (!address) return res.status(404).json({ success: false, message: 'Address not found' });
    let shippingAddressChanged = false;
    if (type === 'shipping') {
      user.shippingAddress = addressId;
      shippingAddressChanged = true;
    }
    if (type === 'billing') user.billingAddress = addressId;
    await user.save();
    // Update Customer.address if shipping address changed and user is a customer
    if (shippingAddressChanged && user.customer) {
      await Customer.findByIdAndUpdate(
        user.customer,
        { address: {
            street: address.street,
            zipCode: address.zipCode,
            city: address.city,
            country: address.country
          }
        }
      );
    }
    res.status(200).json({ success: true, message: `Default ${type} address set`, shippingAddress: user.shippingAddress, billingAddress: user.billingAddress });
  } catch (error) {
    console.error('Set default address error:', error);
    res.status(500).json({ success: false, message: 'Server error while setting default address', error: error.message });
  }
};

// Set shipping and billing address as the same
const setShippingAndBillingSame = async (req, res) => {
  try {
    const { addressId } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const address = user.addresses.id(addressId);
    if (!address) return res.status(404).json({ success: false, message: 'Address not found' });
    user.shippingAddress = addressId;
    user.billingAddress = addressId;
    await user.save();
    // Update Customer.address if user is a customer
    if (user.customer) {
      await Customer.findByIdAndUpdate(
        user.customer,
        { address: {
            street: address.street,
            zipCode: address.zipCode,
            city: address.city,
            country: address.country
          }
        }
      );
    }
    res.status(200).json({ success: true, message: 'Shipping and billing address set as the same', shippingAddress: user.shippingAddress, billingAddress: user.billingAddress });
  } catch (error) {
    console.error('Set shipping and billing same error:', error);
    res.status(500).json({ success: false, message: 'Server error while setting shipping and billing address', error: error.message });
  }
};

// Get all addresses
const getAddresses = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, addresses: user.addresses, shippingAddress: user.shippingAddress, billingAddress: user.billingAddress });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching addresses', error: error.message });
  }
};

// Get shipping, billing, or both addresses
const getUserAddress = async (req, res) => {
  try {
    const { type } = req.query; // or req.params if you prefer route param
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let result = {};
    if (type === 'shipping') {
      const shipping = user.addresses.id(user.shippingAddress);
      result.shippingAddress = shipping || null;
    } else if (type === 'billing') {
      const billing = user.addresses.id(user.billingAddress);
      result.billingAddress = billing || null;
    } else {
      // both or unspecified
      const shipping = user.addresses.id(user.shippingAddress);
      const billing = user.addresses.id(user.billingAddress);
      result.shippingAddress = shipping || null;
      result.billingAddress = billing || null;
    }

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Get user address error:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching address', error: error.message });
  }
};

// Add product to wishlist
const addToWishlist = async (req, res) => {
  try {
    console.log('Add to wishlist - Request body:', req.body);
    console.log('Add to wishlist - User:', req.user);
    const { itemId } = req.body;
    if (!itemId) {
      console.log('Missing itemId in request');
      return res.status(400).json({ success: false, message: 'Item ID is required' });
    }
    console.log('Looking for item with ID:', itemId);
    // Check if item exists
    const item = await Item.findById(itemId);
    if (!item) {
      console.log('Item not found:', itemId);
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    const user = await User.findById(req.user._id);
    if (!user) {
      console.log('User not found:', req.user._id);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    // Convert itemId to string for comparison
    const itemIdStr = String(itemId);
    const existingWishlistStr = user.wishlist.map(id => String(id));
    // Prevent duplicates
    if (existingWishlistStr.includes(itemIdStr)) {
      console.log('Item already in wishlist:', itemIdStr);
      return res.status(400).json({ success: false, message: 'Item already in wishlist' });
    }
    user.wishlist.push(itemId);
    await user.save();
    console.log('Item added to wishlist successfully:', itemIdStr);
    res.status(200).json({ 
      success: true, 
      message: 'Item added to wishlist', 
      wishlist: user.wishlist 
    });
  } catch (error) {
    console.error('Add to wishlist error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error while adding to wishlist', 
      error: error.message 
    });
  }
};

// Remove product from wishlist
const removeFromWishlist = async (req, res) => {
  try {
    console.log('Remove from wishlist - Request body:', req.body);
    console.log('Remove from wishlist - User:', req.user);
    const { itemId } = req.body;
    if (!itemId) {
      console.log('Missing itemId in request');
      return res.status(400).json({ success: false, message: 'Item ID is required' });
    }
    const user = await User.findById(req.user._id);
    if (!user) {
      console.log('User not found:', req.user._id);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    // Convert to strings for comparison
    const itemIdStr = String(itemId);
    const wishlistStrings = user.wishlist.map(id => String(id));
    const index = wishlistStrings.indexOf(itemIdStr);
    if (index === -1) {
      console.log('Item not in wishlist:', itemIdStr);
      return res.status(404).json({ success: false, message: 'Item not in wishlist' });
    }
    user.wishlist.splice(index, 1);
    await user.save();
    console.log('Item removed from wishlist successfully:', itemIdStr);
    res.status(200).json({ 
      success: true, 
      message: 'Item removed from wishlist', 
      wishlist: user.wishlist 
    });
  } catch (error) {
    console.error('Remove from wishlist error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error while removing from wishlist', 
      error: error.message 
    });
  }
};

// Get user's wishlist
const getWishlist = async (req, res) => {
  try {
    console.log('Getting wishlist for user:', req.user._id);
    
    const user = await User.findById(req.user._id).populate({
      path: 'wishlist',
      select: 'ItemName ItemCode image imagePath PriceList ItemPrices QuantityOnStock',
    });
    
    if (!user) {
      console.log('User not found:', req.user._id);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    console.log('User wishlist found:', user.wishlist?.length || 0, 'items');
    
    res.status(200).json({ 
      success: true, 
      wishlist: user.wishlist || [],
      count: user.wishlist?.length || 0
    });
  } catch (error) {
    console.error('Get wishlist error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error while fetching wishlist', 
      error: error.message,
      wishlist: [] // Provide empty array as fallback
    });
  }
};

module.exports = {
  // Registration functions
  registerCustomer,
  registerBusiness,
  createAdmin,
  registerSuperAdmin,
  
  // Authentication
  login,
  
  // Profile management
  getProfile,
  updateProfile,
  updateTermsAgreement,
  
  // User management (Admin functions)
  getAllUsers,
  getUserById,
  updateUserStatus,
  deleteUser,
  getAdmins,
  updateDocumentVerification,
  
  // Address management
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  setShippingAndBillingSame,
  getAddresses,
  getUserAddress,
  
  // Wishlist management
  addToWishlist,
  removeFromWishlist,
  getWishlist
};