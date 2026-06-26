export default () => ({
  notification: {
    smtp: {
      host: process.env.SMTP_HOST,
      port: +(process.env.SMTP_PORT ?? '587') || 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || 'noreply@ai-clinic.com',
    },
    vapid: {
      subject: process.env.VAPID_SUBJECT || 'mailto:admin@ai-clinic.com',
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    },
  },
});
