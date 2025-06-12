import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class ExceptionTemplateFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    let status: number, message: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse()['message'] || 'Unknown Error';
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal Server Error';
      console.error(exception, host);
    }

    const response = host.switchToHttp().getResponse();
    response.status(status).json({ status, message, data: null });
  }
}
