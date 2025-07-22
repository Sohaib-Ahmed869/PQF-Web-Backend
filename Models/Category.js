const mongoose = require("mongoose");
const { Schema } = mongoose;

const CategorySchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  ItemsGroupCode: {
    type: Number,
    required: true
  },
  image: {
    type: String,
    default: ""
  },
  imageKey: {
    type: String,
    default: ""
  },
  store: {
    type: Schema.Types.ObjectId,
    ref: 'Store'
  },
  isActive: {
    type: Boolean,
    default: true
  },
}, { timestamps: true });

// Index for better query performance
CategorySchema.index({ ItemsGroupCode: 1 });
CategorySchema.index({ name: 1 });
CategorySchema.index({ categoryType: 1 });
CategorySchema.index({ isActive: 1 });
CategorySchema.index({ store: 1 }); // NEW: Index for store reference
// Compound unique indexes for store-scoped uniqueness
CategorySchema.index({ name: 1, store: 1 }, { unique: true });
CategorySchema.index({ ItemsGroupCode: 1, store: 1 }, { unique: true });

// Static method to get category by number
CategorySchema.statics.findByCategoryNumber = function(categoryNumber) {
  return this.findOne({ categoryNumber });
};

// NEW: Static method to find categories by store
CategorySchema.statics.findByStore = function(storeId) {
  return this.find({ 
    store: storeId,
    isActive: true 
  });
};



module.exports = mongoose.model("Category", CategorySchema);