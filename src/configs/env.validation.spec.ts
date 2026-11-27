import { Logger } from '@nestjs/common';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes valid configuration and warns about optional integrations', () => {
    const config = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      SESSION_SECRET: 'super-secret-value-at-least-16',
      APP_PORT: '3000',
      AUTH_SALT_ROUNDS: '10',
      SMTP_PORT: '587',
    };

    expect(validateEnv(config)).toBe(config);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('throws listing all missing or non-numeric required settings', () => {
    expect(() =>
      validateEnv({
        APP_PORT: 'abc',
        AUTH_SALT_ROUNDS: 'nope',
        SMTP_PORT: 'bad',
      }),
    ).toThrow(
      /DATABASE_URL is required[\s\S]*SESSION_SECRET is required[\s\S]*APP_PORT must be a valid number[\s\S]*AUTH_SALT_ROUNDS must be a valid number[\s\S]*SMTP_PORT must be a valid number/,
    );
  });

  it('emits production-specific warnings for DEBUG, connection_limit, and seed defaults', () => {
    validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      SESSION_SECRET: 'short',
      DEBUG: 'true',
    });

    const warnings = (Logger.prototype.warn as jest.Mock).mock.calls.map(
      (call) => String(call[0]),
    );
    expect(warnings.some((w) => w.includes('shorter than 16'))).toBe(true);
    expect(warnings.some((w) => w.includes('connection_limit'))).toBe(true);
    expect(warnings.some((w) => w.includes('DEBUG=true'))).toBe(true);
    expect(warnings.some((w) => w.includes('SUPERUSER_EMAIL'))).toBe(true);
  });
});
