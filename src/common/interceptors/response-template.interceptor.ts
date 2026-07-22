import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { Readable } from 'stream';

@Injectable()
export class ResponseTemplateInterceptor<T> implements NestInterceptor<T, any> {
  private readonly logger = new Logger(ResponseTemplateInterceptor.name);

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<any> | Promise<Observable<any>> {
    return next.handle().pipe(
      map((data: unknown) => {
        if (
          data instanceof StreamableFile ||
          Buffer.isBuffer(data) ||
          data instanceof Readable
        ) {
          return data;
        }

        const response = context.switchToHttp().getResponse();
        try {
          const statusCode: number = response.statusCode;

          // 204 No Content should return no body
          if (statusCode === HttpStatus.NO_CONTENT) {
            return undefined;
          }

          let message = 'Success!';
          let contents: unknown = data;

          // Only extract statusCode/message from plain object data
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            const { message: dataMessage, statusCode: dataStatus, ...rest } =
              data as Record<string, unknown>;
            if (dataStatus) response.statusCode = dataStatus;
            if (dataMessage && typeof dataMessage === 'string') {
              message = dataMessage;
            }
            contents = rest;
          }

          return {
            message,
            contents: contents ?? null,
            status: response.statusCode,
          };
        } catch (ex) {
          this.logger.error('Could not transform response:', ex);
        }
        return {
          message: 'Unknown Error',
          contents: null,
          status: HttpStatus.INTERNAL_SERVER_ERROR,
        };
      }),
    );
  }
}
