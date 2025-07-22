const express = require('express');
const router = express.Router();
const superAdminCategoryController = require('../../Controllers/SuperAdmin/CategoryController');
const { protect, requireSuperAdmin } = require('../../Middleware/Authentication');
const { categoryUpload } = require('../../Config/S3'); // Assuming you have category upload config

router.use(protect);
router.use(requireSuperAdmin);

router.get('/getAll', superAdminCategoryController.getAllCategoriesAllStores);
router.get('/stats', superAdminCategoryController.getGlobalCategoryStats);
router.get('/store/:storeId', superAdminCategoryController.getCategoriesBySpecificStore);
router.get('/IndividualCategory/:id', superAdminCategoryController.getAnyCategoryById);
router.put('/update/:id', categoryUpload.fields([{ name: 'image', maxCount: 1 }]), superAdminCategoryController.updateAnyCategory);
router.delete('/delete/:id', superAdminCategoryController.deleteAnyCategory);
router.post('/add', categoryUpload.fields([{ name: 'image', maxCount: 1 }]), superAdminCategoryController.createCategoryForAnyStore);


module.exports = router;