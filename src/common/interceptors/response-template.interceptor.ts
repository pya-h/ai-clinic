import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

export class ResponseTemplateInterceptor<T> implements NestInterceptor<T, any> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<any> | Promise<Observable<any>> {
    return next.handle().pipe(
      map((data: unknown) => {
        const response = context.switchToHttp().getResponse();
        try {
          if (data) {
            if (data['statusCode']) response.statusCode = data['statusCode'];

            if (data['message']) {
              response.message = data['message'];
              delete data['message'];
            } else response.message = 'Success!';
          }
          return {
            message: response.message,
            data,
            status: response.statusCode,
          };
        } catch (ex) {
          console.error('Could not transform response:', ex);
        }
        return {
          message: 'Unknown Error',
          data: null,
          status: HttpStatus.INTERNAL_SERVER_ERROR,
        };
      }),
    );
  }
}
