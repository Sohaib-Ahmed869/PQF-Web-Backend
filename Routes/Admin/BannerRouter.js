const express = require('express');
const router = express.Router();
const BannerController = require('../../Controllers/Admin/BannerController');
const { bannerUpload } = require('../../Config/S3');
const { protect, requireAdmin } = require('../../Middleware/Authentication');

router.use(protect);
router.use(requireAdmin);
router.post('/create', bannerUpload.single('image'), BannerController.createBanner);
router.get('/getAll', BannerController.getBanners);
router.get('/store', BannerController.getBannersByStore);
router.get('/stats', BannerController.getBannerStats);
router.get('/getIndividual/:id', BannerController.getBannerById);
router.put('/update/:id', bannerUpload.single('image'), BannerController.updateBanner);
router.patch('/toggle-visibility/:id', BannerController.toggleBannerVisibility);
router.delete('/delete/:id', BannerController.deleteBanner);

module.exports = router;