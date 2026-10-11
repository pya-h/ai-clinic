import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UserStatus,
  UserStatusCache,
  accountBlockReason,
  withCurrentRole,
} from '../user-status';

/**
 * Variant of CookieAuthGuard that does NOT throw when no session exists.
 * Sets `request.user = null` for unauthenticated (guest) requests.
 * Needed for AI endpoints where guests can chat but SOAPs are only saved for authenticated users.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalAuthGuard.name);

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const session: any = (request as any).session;
    (request as any).user = await this.currentUser(
      session?.get('user'),
      session,
    );
    return true;
  }

  private async currentUser(user: any, session: any): Promise<any | null> {
    if (!user) return null;

    if (user.isActive === false || user.isBanned === true) {
      session.delete();
      return null;
    }

    if (!this.prisma) return user;

    let status: UserStatus | null;
    try {
      status = await UserStatusCache.get(this.prisma, user.id);
    } catch (error) {
      // Unlike CookieAuthGuard, fall back to a guest: these routes work without an account.
      this.logger.warn(
        `Failed to verify user status from DB for ${user.id}: ${error}`,
      );
      return null;
    }

    if (!status) return null;

    if (accountBlockReason(status)) {
      session.delete();
      return null;
    }

    const current = withCurrentRole(user, status);
    if (current !== user) session.set('user', current);
    return current;
  }
}
