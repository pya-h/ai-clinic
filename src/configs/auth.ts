export default () => ({
  auth: {
    saltRounds: process.env.AUTH_SALT_ROUNDS,
    sessionSecret: process.env.SESSION_SECRET,
    sessionCookieName: process.env.SESSION_COOKIE_NAME,
  },
});
