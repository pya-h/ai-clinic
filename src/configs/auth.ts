export default () => ({
  auth: {
    saltRounds: parseInt(process.env.AUTH_SALT_ROUNDS, 10) || 12,
    sessionSecret: process.env.SESSION_SECRET,
    sessionCookieName: process.env.SESSION_COOKIE_NAME,
  },
});
