export default () => ({
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiry: process.env.JWT_EXPIRY,
    jwtIssuer: process.env.JWT_ISSUER,
  },
});
