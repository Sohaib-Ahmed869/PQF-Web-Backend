// Store.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const storeSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Store name is required'],
    trim: true,
    maxlength: [100, 'Store name cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  location: {
    address: {
      street: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, trim: true },
      zipCode: { type: String, trim: true },
      country: { type: String, required: true, trim: true }
    },
    coordinates: {
      latitude: { type: Number },
      longitude: { type: Number }
    }
  },
  contact: {
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    website: {
      type: String,
      trim: true
    }
  },
  businessHours: {
    monday: {
      open: { type: String, default: '09:00' },
      close: { type: String, default: '18:00' },
      closed: { type: Boolean, default: false }
    },
    tuesday: {
      open: { type: String, default: '09:00' },
      close: { type: String, default: '18:00' },
      closed: { type: Boolean, default: false }
    },
    wednesday: {
      open: { type: String, default: '09:00' },
      close: { type: String, default: '18:00' },
      closed: { type: Boolean, default: false }
    },
    thursday: {
      open: { type: String, default: '09:00' },
      close: { type: String, default: '18:00' },
      closed: { type: Boolean, default: false }
    },
    friday: {
      open: { type: String, default: '09:00' },
      close: { type: String, default: '18:00' },
      closed: { type: Boolean, default: false }
    },
    saturday: {
      open: { type: String, default: '09:00' },
      close: { type: String, default: '18:00' },
      closed: { type: Boolean, default: false }
    },
    sunday: {
      open: { type: String, default: '10:00' },
      close: { type: String, default: '17:00' },
      closed: { type: Boolean, default: false }
    }
  },
  settings: {
    currency: {
      type: String,
      default: 'USD',
      enum: ['USD', 'EUR', 'GBP', 'AED', 'CAD', 'AUD', 'JPY']
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    language: {
      type: String,
      default: 'en',
      enum: ['en', 'fr', 'ar', 'es', 'de']
    },
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'maintenance', 'closed'],
    default: 'active'
  },
  storeManager: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  admins: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // NEW: Categories relationship
  categories: [{
    type: Schema.Types.ObjectId,
    ref: 'Category'
  }],
  // NEW: Banners relationship
  banners: [{
    type: Schema.Types.ObjectId,
    ref: 'Banner'
  }],
  features: {
    onlineOrdering: { type: Boolean, default: true },
    delivery: { type: Boolean, default: true },
    pickup: { type: Boolean, default: true },
    reservations: { type: Boolean, default: false }
  },
  images: [{
    url: { type: String },
    alt: { type: String },
    isPrimary: { type: Boolean, default: false }
  }],
  socialMedia: {
    facebook: { type: String, trim: true },
    instagram: { type: String, trim: true },
    twitter: { type: String, trim: true }
  }
}, {
  timestamps: true
});

// Index for location-based queries
storeSchema.index({ 'location.coordinates': '2dsphere' });
storeSchema.index({ status: 1 });
storeSchema.index({ createdBy: 1 });
storeSchema.index({ categories: 1 }); // NEW: Index for categories
storeSchema.index({ banners: 1 }); // NEW: Index for banners

// Virtual for full address
storeSchema.virtual('fullAddress').get(function() {
  const addr = this.location.address;
  return `${addr.street}, ${addr.city}, ${addr.state ? addr.state + ', ' : ''}${addr.country} ${addr.zipCode || ''}`.trim();
});

// Method to check if store is currently open
storeSchema.methods.isCurrentlyOpen = function() {
  const now = new Date();
  const dayOfWeek = now.toLocaleLowerCase('en-US', { weekday: 'long' });
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM format
  
  const todayHours = this.businessHours[dayOfWeek];
  
  if (todayHours.closed) {
    return false;
  }
  
  return currentTime >= todayHours.open && currentTime <= todayHours.close;
};

// NEW: Method to add category to store
storeSchema.methods.addCategory = function(categoryId) {
  if (!this.categories.includes(categoryId)) {
    this.categories.push(categoryId);
  }
  return this.save();
};

// NEW: Method to remove category from store
storeSchema.methods.removeCategory = function(categoryId) {
  this.categories = this.categories.filter(id => !id.equals(categoryId));
  return this.save();
};

// NEW: Method to get store categories with populated data
storeSchema.methods.getCategoriesWithItems = function() {
  return this.populate({
    path: 'categories',
    populate: {
      path: 'items',
      model: 'Item'
    }
  });
};

// NEW: Method to get active banners for store
storeSchema.methods.getActiveBanners = function(position = null) {
  const Banner = mongoose.model('Banner');
  const query = { store: this._id };
  if (position) query.position = position;
  return Banner.findActiveByStore(this._id);
};

// NEW: Method to add banner to store
storeSchema.methods.addBanner = function(bannerId) {
  if (!this.banners.includes(bannerId)) {
    this.banners.push(bannerId);
  }
  return this.save();
};

// NEW: Method to remove banner from store
storeSchema.methods.removeBanner = function(bannerId) {
  this.banners = this.banners.filter(id => !id.equals(bannerId));
  return this.save();
};

// Static method to find stores by location
storeSchema.statics.findByLocation = function(latitude, longitude, maxDistance = 10000) {
  return this.find({
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    },
    status: 'active'
  });
};

// NEW: Static method to find stores by category
storeSchema.statics.findByCategory = function(categoryId) {
  return this.find({
    categories: categoryId,
    status: 'active'
  });
};

module.exports = mongoose.model('Store', storeSchema);