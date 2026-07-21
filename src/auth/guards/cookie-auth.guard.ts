import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

@Injectable()
export class CookieAuthGuard implements CanActivate {
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
    return true;
  }
}
