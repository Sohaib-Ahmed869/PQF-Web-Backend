const express = require('express');
const router = express.Router();
const superAdminBannerController = require('../../Controllers/SuperAdmin/BannerController');
const { protect, requireSuperAdmin } = require('../../Middleware/Authentication');
const { bannerUpload } = require('../../Config/S3');

router.use(protect);
router.use(requireSuperAdmin);

router.get('/getAll', superAdminBannerController.getAllBannersAllStores);
router.get('/stats', superAdminBannerController.getGlobalBannerStats);
router.get('/store/:storeId', superAdminBannerController.getBannersBySpecificStore);
router.get('/IndividualBanner/:id', superAdminBannerController.getAnyBannerById);
router.put('/update/:id', bannerUpload.single('image'), superAdminBannerController.updateAnyBanner);
router.delete('/delete/:id', superAdminBannerController.deleteAnyBanner);
router.post('/add', bannerUpload.single('image'), superAdminBannerController.addBannerToAnyStore);

module.exports = router;