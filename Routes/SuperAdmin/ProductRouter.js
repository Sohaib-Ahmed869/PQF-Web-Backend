const express = require('express');
const router = express.Router();
const superAdminProductController = require('../../Controllers/SuperAdmin/ProductController');
const { protect, requireSuperAdmin } = require('../../Middleware/Authentication');
const { productUpload } = require('../../Config/S3');

// Apply middleware to all routes
router.use(protect);
router.use(requireSuperAdmin);

router.get('/getAll', superAdminProductController.getAllProductsAllStores);
router.get('/stats', superAdminProductController.getGlobalProductStats);
router.get('/store/:storeId', superAdminProductController.getProductsBySpecificStore);
router.get('/IndividualProduct/:id', superAdminProductController.getAnyProductById);
router.put('/update/:id', 
  productUpload.fields([{ name: 'image', maxCount: 1 }]), 
  superAdminProductController.updateAnyProduct
);
router.delete('/delete/:id', superAdminProductController.deleteAnyProduct);


module.exports = router;