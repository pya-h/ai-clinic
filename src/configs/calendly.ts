export default () => ({
  calendly: {
    apiKey: process.env.CALENDLY_API_KEY,
    organizationUri: process.env.CALENDLY_ORGANIZATION_URI,
    webhookSigningKey: process.env.CALENDLY_WEBHOOK_SIGNING_KEY,
  },
});
