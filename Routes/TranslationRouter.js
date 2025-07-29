const express = require("express");
const TranslationController = require("../Controllers/TranslationController");

const router = express.Router();

// Routes
router.get("/test", TranslationController.testApi);
router.post("/", TranslationController.translateSingle);
router.post("/translate-batch", TranslationController.translateBatch);
router.get("/usage", TranslationController.getUsage);
router.get("/health", TranslationController.healthCheck);

module.exports = router;