import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class ExceptionTemplateFilter implements ExceptionFilter {
  private readonly logger = new Logger(ExceptionTemplateFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    let status: number, message: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      this.logger.warn(exception.getResponse());
      const responseBody = exception.getResponse();
      const rawMessage = responseBody['message'] || 'Unknown Error';
      // class-validator returns message as string[], join for display
      message = Array.isArray(rawMessage) ? rawMessage.join('; ') : rawMessage;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal Server Error';
      this.logger.error(exception);
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    
    // Fastify-specific response handling
    response.status(status).send({
      status,
      message,
      contents: null,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
