import { UnauthorizedError } from '@botpress/chat';
import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { User } from '@prisma/client';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as User;

    if (user && user.isAdmin) {
      return true;
    }

    throw new UnauthorizedError('Access denied.');
  }
}
