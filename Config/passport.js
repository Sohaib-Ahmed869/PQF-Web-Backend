const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../Models/User');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/api/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // 1. Try to find user by Google ID
      let user = await User.findOne({ 'socialLogin.google.id': profile.id });
      if (user) return done(null, user);

      // 2. Try to find user by email
      const email = profile.emails[0].value;
      user = await User.findOne({ email });
      if (user) {
        // Link Google account to existing user
        user.socialLogin = {
          ...user.socialLogin,
          enabled: true,
          google: {
            id: profile.id,
            email: email
          }
        };
        await user.save();
        return done(null, user);
      }

      // 3. Create new user
      user = await User.create({
        name: profile.displayName,
        email: email,
        socialLogin: {
          enabled: true,
          google: {
            id: profile.id,
            email: email
          }
        },
        role: 'customer',
        status: 'active'
      });
      return done(null, user);
    } catch (err) {
      return done(err, null);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});

module.exports = passport; 