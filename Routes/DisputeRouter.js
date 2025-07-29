const express = require('express');
const router = express.Router();
const DisputeController = require('../Controllers/DisputeController');
const { protect, requireAdmin } = require('../Middleware/Authentication');

router.post('/create', protect, DisputeController.createDispute);
router.get('/admin/all-disputes', protect, requireAdmin, DisputeController.getAllDisputes);
router.get('/user/me', protect, DisputeController.getCurrentUserDisputes);
router.get('/user/:userId', protect, DisputeController.getUserDisputes);
router.get('/:disputeId/chat', protect, DisputeController.getDisputeChat);
router.post('/:disputeId/response', protect, DisputeController.sendDisputeResponse);
router.put('/admin/:disputeId/status', protect, requireAdmin, DisputeController.updateDisputeStatus);
router.get('/admin/stats', protect, requireAdmin, DisputeController.getDisputeStats);

module.exports = router;