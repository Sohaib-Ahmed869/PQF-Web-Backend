const express = require('express');
const router = express.Router();
const {
  createStore,
  getAllStores,
  getStoreById,
  updateStore,
  updateStoreStatus,
  deleteStore,
  assignAdminToStore,
  removeAdminFromStore,
  getStoresByLocation,
  getStoreStats
} = require('../../Controllers/SuperAdmin/StoreController');
const { 
  protect, 
  requireSuperAdmin,
  authorize 
} = require("../../Middleware/Authentication");

router.get('/nearby', getStoresByLocation);

// Protected routes (authentication required)
router.use(protect);
router.get('/getAllStores', getAllStores);
router.get('/getIndividual/:id', getStoreById);
router.get('/:id/stats', authorize('superAdmin', 'admin'), getStoreStats);
router.put('/:id', authorize('superAdmin', 'admin'), updateStore);
router.post('/create', requireSuperAdmin, createStore);
router.put('/:id/status', requireSuperAdmin, updateStoreStatus);
router.delete('/:id', requireSuperAdmin, deleteStore);
router.put('/:id/assign-admin', requireSuperAdmin, assignAdminToStore);
router.put('/:id/remove-admin', requireSuperAdmin, removeAdminFromStore);

module.exports = router;