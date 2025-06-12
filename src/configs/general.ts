export default () => ({
  general: {
    debug: (process.env.DEBUG || 'false').toLowerCase() === 'true',
    appPort: +process.env.APP_PORT,
    appName: process.env.APP_NAME,
    slogan: process.env.SLOGAN,
  },
});
