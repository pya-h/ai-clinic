import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const url = req.url;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          const ms = Date.now() - start;
          this.logger.log(`${method} ${url} ${res.statusCode} ${ms}ms`);
        },
        error: (err) => {
          const ms = Date.now() - start;
          const status = err?.status || err?.getStatus?.() || 500;
          this.logger.warn(`${method} ${url} ${status} ${ms}ms`);
        },
      }),
    );
  }
}
