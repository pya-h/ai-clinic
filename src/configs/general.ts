export default () => ({
  general: {
    debug: (process.env.DEBUG || 'false').toLowerCase() === 'true',
    // Runtime environment. Anything other than 'production' is treated as a
    // development environment (e.g. relaxes rate limiting for seeding/testing).
    appEnv: (
      process.env.APP_ENV ||
      process.env.NODE_ENV ||
      'development'
    ).toLowerCase(),
    appPort: parseInt(process.env.APP_PORT ?? '8080', 10) || 8080,
    appName: process.env.APP_NAME,
    slogan: process.env.SLOGAN,
  },
});
