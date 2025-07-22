const express = require('express');
const passport = require('../Config/passport');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Start Google OAuth
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Handle Google OAuth callback
router.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/auth/google/failure' }),
  (req, res) => {
    const token = jwt.sign(
      { id: req.user._id, role: req.user.role },
      process.env.JWT_SECRET || 'your-super-secret-jwt-key',
      { expiresIn: '30d' }
    );
    res.redirect(`http://localhost:5173/google-success?token=${token}`);
  }
);

// Error redirect
router.get('/auth/google/failure', (req, res) => {
  res.redirect('http://localhost:5173/google-success?error=Google%20authentication%20failed');
});

module.exports = router; 