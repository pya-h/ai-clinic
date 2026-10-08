import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type UserStatus = Pick<
  User,
  'isActive' | 'isBanned' | 'banReason' | 'role' | 'isAdmin' | 'isSuperAdmin'
>;

@Injectable()
export class CookieAuthGuard implements CanActivate {
  private static readonly statusCache = new Map<string, UserStatus & { checkedAt: number }>();
  private static readonly STATUS_TTL = 60_000;
  private readonly logger = new Logger(CookieAuthGuard.name);

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Call after changing a user's role, admin flags, ban or active state, so it applies on their next request. */
  static invalidateUserStatus(userId: string): void {
    CookieAuthGuard.statusCache.delete(userId);
  }

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
    const status = await this.getUserStatus(user.id);
    if (!status) return true;

    if (status.isBanned) {
      session.delete();
      throw new ForbiddenException(
        `Your account has been banned.${status.banReason ? ` Reason: ${status.banReason}` : ''}`,
      );
    }
    if (!status.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }

    // The session holds a login-time copy of the user; role and admin checks must follow the DB.
    if (
      user.role !== status.role ||
      user.isAdmin !== status.isAdmin ||
      user.isSuperAdmin !== status.isSuperAdmin
    ) {
      const refreshed = {
        ...user,
        role: status.role,
        isAdmin: status.isAdmin,
        isSuperAdmin: status.isSuperAdmin,
      };
      session.set('user', refreshed);
      request.user = refreshed;
    }

    return true;
  }

  private async getUserStatus(userId: string): Promise<UserStatus | null> {
    const now = Date.now();
    const cached = CookieAuthGuard.statusCache.get(userId);
    if (cached && now - cached.checkedAt < CookieAuthGuard.STATUS_TTL) {
      return cached;
    }

    let dbUser: UserStatus | null;
    try {
      dbUser = await this.prisma!.user.findFirst({
        where: { id: userId },
        select: {
          isActive: true,
          isBanned: true,
          banReason: true,
          role: true,
          isAdmin: true,
          isSuperAdmin: true,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to verify user status from DB for ${userId}: ${error}`);
      return null;
    }

    if (!dbUser) {
      this.logger.warn(`User ${userId} has valid session but not found in DB`);
      return null;
    }

    CookieAuthGuard.statusCache.set(userId, { ...dbUser, checkedAt: now });
    return dbUser;
  }
}
