export default () => ({
  storage: {
    type: process.env.STORAGE_TYPE || 'local', // 'local' | 's3'
    localPath: process.env.STORAGE_LOCAL_PATH || './uploads',
  },
});
