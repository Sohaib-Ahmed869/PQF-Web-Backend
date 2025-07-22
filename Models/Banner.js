const mongoose = require('mongoose');
const { Schema } = mongoose;

const bannerSchema = new Schema(
  {
    image: {
      type: String,
      required: [true, 'Banner image is required']
    },
    imagePath: {
      type: String,
      required: [true, 'Banner image path is required']
    },
    imageKey: {
      type: String,
      default: ""
    },
    store: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store is required']
    },
    isVisible: {
      type: Boolean,
      default: true
    },
    bannerType: {
      type: String,
      enum: ['promotional', 'announcement', 'featured', 'seasonal', 'advertisement'],
      default: 'promotional'
    },
  },
  { 
    timestamps: true 
  }
);

module.exports = mongoose.model('Banner', bannerSchema);