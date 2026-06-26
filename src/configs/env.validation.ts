import { Logger } from '@nestjs/common';

const logger = new Logger('EnvValidation');

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.DATABASE_URL) {
    errors.push('DATABASE_URL is required');
  }

  if (!config.SESSION_SECRET) {
    errors.push('SESSION_SECRET is required');
  } else if ((config.SESSION_SECRET as string).length < 16) {
    warnings.push(
      'SESSION_SECRET is shorter than 16 characters — use a stronger secret in production',
    );
  }

  if (config.APP_PORT && isNaN(Number(config.APP_PORT))) {
    errors.push('APP_PORT must be a valid number');
  }

  if (config.AUTH_SALT_ROUNDS && isNaN(Number(config.AUTH_SALT_ROUNDS))) {
    errors.push('AUTH_SALT_ROUNDS must be a valid number');
  }

  if (config.SMTP_PORT && isNaN(Number(config.SMTP_PORT))) {
    errors.push('SMTP_PORT must be a valid number');
  }

  if (
    config.NODE_ENV === 'production' &&
    config.DATABASE_URL &&
    !(config.DATABASE_URL as string).includes('connection_limit')
  ) {
    warnings.push(
      'DATABASE_URL has no connection_limit parameter — Prisma uses default pool size; set ?connection_limit=N for production',
    );
  }

  if (!config.CORS_ORIGIN) {
    warnings.push(
      'CORS_ORIGIN not set — defaulting to http://localhost:5173 (set explicitly for production)',
    );
  }

  if (
    (config.DEBUG as string)?.toLowerCase() === 'true' &&
    config.NODE_ENV === 'production'
  ) {
    warnings.push(
      'DEBUG=true in production — validation errors will expose schema details',
    );
  }

  if (
    config.NODE_ENV === 'production' &&
    (!config.SUPERUSER_EMAIL || !config.SUPERUSER_PASSWORD)
  ) {
    warnings.push(
      'SUPERUSER_EMAIL / SUPERUSER_PASSWORD not set — seed will use hardcoded defaults',
    );
  }

  if (!config.OPENAI_API_KEY) {
    warnings.push('OPENAI_API_KEY not set — AI features will not work');
  }
  if (!config.BOTAGENT_KEY) {
    warnings.push('BOTAGENT_KEY not set — Botpress chat will not work');
  }
  if (!config.SMTP_HOST) {
    warnings.push(
      'SMTP_HOST not set — email notifications will not work',
    );
  }
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    warnings.push(
      'VAPID keys not set — web push notifications will not work',
    );
  }

  for (const w of warnings) {
    logger.warn(w);
  }

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }

  return config;
}
