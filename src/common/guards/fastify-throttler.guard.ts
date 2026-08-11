import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttler guard that trackes clients by their real IP (behind proxies via
 * `req.ips`) and disables rate limiting entirely outside of production.
 *
 * Rate limiting stays fully active in production (`APP_ENV=production`). In any
 * other environment it is bypassed so local development, automated tests and
 * data-seeding scripts are not blocked by the strict auth limits (5/min).
 */
@Injectable()
export class FastifyThrottlerGuard extends ThrottlerGuard {
  private readonly appEnv = (
    process.env.APP_ENV ||
    process.env.NODE_ENV ||
    'development'
  ).toLowerCase();

  private static warned = false;

  getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(req.ips?.length ? req.ips[0] : req.ip);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.appEnv !== 'production') {
      if (!FastifyThrottlerGuard.warned) {
        FastifyThrottlerGuard.warned = true;
        new Logger('Throttler').warn(
          `Rate limiting is DISABLED (APP_ENV=${this.appEnv}). Set APP_ENV=production to enforce it.`,
        );
      }
      return true;
    }
    return super.canActivate(context);
  }
}
