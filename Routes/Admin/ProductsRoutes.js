const express = require('express');
const router = express.Router();

const {
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  getProductStockByWarehouse,
  updateProductStock,
  getAllProductNames,
  getProductsByCategory,
  suggestProductNames
  
} = require('../../Controllers/Admin/ProductController')

const { productUpload } = require('../../Config/S3');
const { protect, requireAdmin } = require('../../Middleware/Authentication');

router.use(protect);
router.use(requireAdmin);
router.get('/getAll', getAllProducts);
router.get('/getIndividual/:id', getProductById);
router.put('/update/:id',  productUpload.single('image'),updateProduct);
router.delete('/delete/:id', deleteProduct);
router.post('/bulk-delete', bulkDeleteProducts);
router.get('/:id/stock', getProductStockByWarehouse);
router.put('/:id/stock', updateProductStock);
router.get("/getNames",getAllProductNames)
router.get('/by-category', getProductsByCategory);
router.get('/suggest-names', suggestProductNames);

module.exports = router;
