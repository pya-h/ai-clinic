export default () => ({
  general: {
    debug: (process.env.DEBUG || 'false').toLowerCase() === 'true',
    appPort: parseInt(process.env.APP_PORT ?? '8080', 10) || 8080,
    appName: process.env.APP_NAME,
    slogan: process.env.SLOGAN,
  },
});
