import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../../prisma/prisma.service';
import { UserStatus, UserStatusCache, accountBlockReason, withCurrentRole } from '../user-status';

@Injectable()
export class CookieAuthGuard implements CanActivate {
  private readonly logger = new Logger(CookieAuthGuard.name);

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const session: any = (request as any).session;
    const user = session?.get('user');

    if (!user) {
      throw new UnauthorizedException('Not authenticated');
    }

    if (user.isActive === false) {
      throw new ForbiddenException('Account is deactivated');
    }

    if (user.isBanned === true) {
      session.delete();
      throw new ForbiddenException(
        `Your account has been banned.${user.banReason ? ` Reason: ${user.banReason}` : ''}`,
      );
    }

    (request as any).user = user;

    if (this.prisma) {
      return this.verifyUserStatus(user, session, request);
    }
    return true;
  }

  private async verifyUserStatus(user: any, session: any, request: any): Promise<boolean> {
    let status: UserStatus | null;
    try {
      status = await UserStatusCache.get(this.prisma!, user.id);
    } catch (error) {
      this.logger.warn(`Failed to verify user status from DB for ${user.id}: ${error}`);
      return true;
    }

    if (!status) {
      this.logger.warn(`User ${user.id} has valid session but not found in DB`);
      return true;
    }

    const blockReason = accountBlockReason(status);
    if (blockReason) {
      if (status.isBanned) session.delete();
      throw new ForbiddenException(blockReason);
    }

    // The session holds a login-time copy of the user; role and admin checks must follow the DB.
    const current = withCurrentRole(user, status);
    if (current !== user) {
      session.set('user', current);
      request.user = current;
    }

    return true;
  }
}
