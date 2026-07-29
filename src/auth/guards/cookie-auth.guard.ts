import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CookieAuthGuard implements CanActivate {
  private static readonly statusCache = new Map<string, { isActive: boolean; isBanned: boolean; banReason: string | null; checkedAt: number }>();
  private static readonly STATUS_TTL = 60_000;
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
      return this.verifyUserStatus(user, session);
    }
    return true;
  }

  private async verifyUserStatus(user: any, session: any): Promise<boolean> {
    const now = Date.now();
    const cached = CookieAuthGuard.statusCache.get(user.id);
    if (cached && now - cached.checkedAt < CookieAuthGuard.STATUS_TTL) {
      if (cached.isBanned) {
        session.delete();
        throw new ForbiddenException(
          `Your account has been banned.${cached.banReason ? ` Reason: ${cached.banReason}` : ''}`,
        );
      }
      if (!cached.isActive) {
        throw new ForbiddenException('Account is deactivated');
      }
      return true;
    }

    let dbUser: { isActive: boolean; isBanned: boolean; banReason: string | null } | null;
    try {
      dbUser = await this.prisma!.user.findFirst({
        where: { id: user.id },
        select: { isActive: true, isBanned: true, banReason: true },
      });
    } catch (error) {
      this.logger.warn(`Failed to verify user status from DB for ${user.id}: ${error}`);
      return true;
    }

    if (!dbUser) {
      this.logger.warn(`User ${user.id} has valid session but not found in DB`);
      return true;
    }

    CookieAuthGuard.statusCache.set(user.id, {
      isActive: dbUser.isActive ?? true,
      isBanned: dbUser.isBanned ?? false,
      banReason: dbUser.banReason ?? null,
      checkedAt: now,
    });

    if (dbUser.isBanned === true) {
      session.delete();
      throw new ForbiddenException(
        `Your account has been banned.${dbUser.banReason ? ` Reason: ${dbUser.banReason}` : ''}`,
      );
    }
    if (dbUser.isActive === false) {
      throw new ForbiddenException('Account is deactivated');
    }

    return true;
  }
}
