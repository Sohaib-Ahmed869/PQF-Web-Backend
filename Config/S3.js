const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Create S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Helper function to create upload config
const createUploadConfig = (folder) => ({
  s3: s3Client,
  bucket: process.env.AWS_S3_BUCKET || 'pqf-banners',
  metadata: (req, file, cb) => {
    cb(null, { fieldName: file.fieldname });
  },
  key: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${folder}/${uniqueSuffix}-${file.originalname}`);
  }
});

// Configure multer for Banner uploads
const bannerUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET || 'pqf-banners',
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `banners/${uniqueSuffix}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
    if (mimetype && extname) {
      return cb(null, true);
    }
        
    cb(new Error('Only image files are allowed (JPEG, JPG, PNG, GIF, WEBP)'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Multer for category images only
const categoryUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET || 'pqf-banners',
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `categories/${uniqueSuffix}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    
    cb(new Error('Only image files are allowed (JPEG, JPG, PNG, GIF, WEBP)'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Multer for product images only
const productUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET || 'pqf-banners',
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `products/${uniqueSuffix}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    
    cb(new Error('Only image files are allowed (JPEG, JPG, PNG, GIF, WEBP)'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Multer for user documents (trade license, ID documents, bank statement)
const documentUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET || 'pqf-banners',
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `documents/${uniqueSuffix}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    console.log('Document upload - file:', file.originalname, 'mimetype:', file.mimetype);
    const filetypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    
    cb(new Error('Only image and document files are allowed (JPEG, JPG, PNG, GIF, WEBP, PDF, DOC, DOCX)'));
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for documents
}).fields([
  { name: 'tradeLicense', maxCount: 1 },
  { name: 'idDocument', maxCount: 1 },
  { name: 'bankStatement', maxCount: 6 } // Allow up to 6 monthly statements
]);

// Function to delete object from S3
const deleteS3Object = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET || 'pqf-banners',
      Key: key
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error('Error deleting from S3:', error);
    return false;
  }
};

module.exports = {
  s3Client,
  deleteS3Object,
  bannerUpload,
  categoryUpload,
  productUpload,
  documentUpload
};