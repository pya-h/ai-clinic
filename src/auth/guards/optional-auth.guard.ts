import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

/**
 * Variant of CookieAuthGuard that does NOT throw when no session exists.
 * Sets `request.user = null` for unauthenticated (guest) requests.
 * Needed for AI endpoints where guests can chat but SOAPs are only saved for authenticated users.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const session: any = (request as any).session;
    const user = session?.get('user');

    if (user?.isActive === false || user?.isBanned === true) {
      session?.delete();
      (request as any).user = null;
      return true;
    }

    (request as any).user = user || null;
    return true;
  }
}
