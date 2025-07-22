const express = require('express');
const router = express.Router();
const {
  createCategory,
  getCategoryById,
  getCategoryByGroupCode,
  getCategoriesByStore,
  updateCategory,
  deleteCategory,
  addItemToCategory,
  removeItemFromCategory,
  getCategoriesWithItemCounts,
  toggleCategoryStatus,
  getCategoryStatsByStore,
  getActiveCategoriesByStore,
  getAllCategoriesAllStores
} = require('../../Controllers/Admin/CategoryController');
const { categoryUpload } = require('../../Config/S3');
const { protect, requireAdmin } = require('../../Middleware/Authentication');

router.use(protect);
router.use(requireAdmin);
router.post('/create', categoryUpload.fields([
  { name: 'image', maxCount: 1 }
]), createCategory);
router.get('/getAll', getAllCategoriesAllStores);
router.get('/getCategoriesWithCounts', getCategoriesWithItemCounts);
router.get('/getCategoriesBystore', getCategoriesByStore);
router.get('/stats', getCategoryStatsByStore);
router.get('/getIndividual/:id', getCategoryById);
router.get('/getByGroupCode/:groupCode', getCategoryByGroupCode);
router.get("/getActiveCategory",getActiveCategoriesByStore)
router.put('/update/:id', categoryUpload.fields([
  { name: 'image', maxCount: 1 }
]), updateCategory);
router.patch('/toggle-status/:id', toggleCategoryStatus);
router.delete('/delete/:id', deleteCategory);
router.post('/:categoryId/addItem', addItemToCategory);
router.delete('/:categoryId/removeItem/:itemId', removeItemFromCategory);

module.exports = router;