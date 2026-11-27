import { ExecutionContext } from '@nestjs/common';
import { FastifyThrottlerGuard } from './fastify-throttler.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('FastifyThrottlerGuard', () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.APP_ENV = originalAppEnv;
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('extracts client IP from req.ips[0] when behind a proxy, falling back to req.ip', async () => {
    const guard = new FastifyThrottlerGuard({} as any, {} as any, {} as any);

    await expect(
      guard.getTracker({ ips: ['203.0.113.5', '10.0.0.1'], ip: '127.0.0.1' }),
    ).resolves.toBe('203.0.113.5');
    await expect(
      guard.getTracker({ ips: [], ip: '198.51.100.7' }),
    ).resolves.toBe('198.51.100.7');
  });

  it('bypasses rate limiting outside production and delegates to ThrottlerGuard in production', async () => {
    process.env.APP_ENV = 'test';
    const nonProdGuard = new FastifyThrottlerGuard(
      {} as any,
      {} as any,
      {} as any,
    );
    const parentSpy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(false);

    await expect(
      nonProdGuard.canActivate({} as ExecutionContext),
    ).resolves.toBe(true);
    expect(parentSpy).not.toHaveBeenCalled();

    process.env.APP_ENV = 'production';
    const prodGuard = new FastifyThrottlerGuard(
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(prodGuard.canActivate({} as ExecutionContext)).resolves.toBe(
      false,
    );
    expect(parentSpy).toHaveBeenCalledTimes(1);
  });
});
