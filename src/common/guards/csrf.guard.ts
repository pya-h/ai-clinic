import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  // Installed with `new CsrfGuard()` in main.ts; Reflector only reads decorator metadata.
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    // Handler only: a class-wide exemption would cover routes added later.
    if (this.reflector.get<boolean>(SKIP_CSRF_KEY, context.getHandler())) return true;

    const cookieToken = request.cookies?.['csrf-token'];
    const headerToken = request.headers['x-csrf-token'] as string | undefined;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException('Invalid or missing CSRF token');
    }

    return true;
  }
}
