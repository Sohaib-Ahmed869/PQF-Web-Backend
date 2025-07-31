const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { connectDB } = require('./db');
const dotenv = require("dotenv");

dotenv.config();
const app = express();

app.use(helmet());

// CRITICAL: Webhook route with raw body parser MUST come before express.json()
// AND it must be the exact webhook path with the raw parser
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// JSON body parsing for ALL OTHER routes
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Rest of your middleware...
const passport = require('./Config/passport');
app.use(passport.initialize());

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://pqf.foodservices.live'
];

if (process.env.CORS_ORIGIN) {
  try {
    const corsUrl = new URL(process.env.CORS_ORIGIN);
    allowedOrigins.push(corsUrl.origin);
  } catch (err) {
    console.warn('Invalid CORS_ORIGIN URL:', process.env.CORS_ORIGIN);
  }
}

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('CORS blocked for origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
connectDB();

// Import General router
const userRoutes = require('./Routes/UserRouter');
const authRouter = require('./Routes/AuthRouter');
const cartRouter = require('./Routes/CartRouter');
const paymentRouter = require('./Routes/PaymentRouter');
const translationRouter = require('./Routes/TranslationRouter');
const disputeRouter = require('./Routes/DisputeRouter');

// SuperAdmin routes
const storeRoutes = require('./Routes/SuperAdmin/StoreRouter');
const BannerRouter=require("./Routes/SuperAdmin/BannerRouter")
const CategoryRouter=require("./Routes/SuperAdmin/CateogryRouter")
const ProductRouter=require("./Routes/SuperAdmin/ProductRouter")

//Admin Imports
const bannerRouter = require('./Routes/Admin/BannerRouter');
const categoryRouter = require('./Routes/Admin/CategoryRouter');
const productsRouter = require('./Routes/Admin/ProductsRoutes');
const orderRouter = require('./Routes/Admin/OrderRouter');

// Website routes
const webRouter = require('./Routes/WebRouter/WebRouter');


// Mount Banner routes
app.use('/api/users', userRoutes);
app.use('/api', authRouter);
app.use('/api/cart', cartRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/translation', translationRouter);
app.use('/api/orderdispute', disputeRouter);

// mount SuperAdmin Routes
app.use('/api/superAdmin/stores', storeRoutes);
app.use('/api/superAdmin/banners',BannerRouter);
app.use('/api/superAdmin/category',CategoryRouter);
app.use('/api/superAdmin/products',ProductRouter);


// mount Admin Routes
app.use('/api/banners', bannerRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', orderRouter);

// Mount Website (public) routes
app.use('/api/web', webRouter);


// Error handling
app.use((err, req, res, next) => {
  console.error('Error details:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Request payload too large',
      error: 'Payload size limit exceeded'
    });
  }

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'CORS error: Origin not allowed',
      error: err.message
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal server error' : err.message,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 API Base URL: http://localhost:${PORT}`);
  console.log(`💳 Webhook URL: http://localhost:${PORT}/api/payment/webhook`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
  } else {
    console.error('❌ Server error:', err);
  }
  process.exit(1);
});

module.exports = app;

