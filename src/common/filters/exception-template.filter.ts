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
    // Only handle HTTP context; let WS/RPC exceptions propagate normally
    if (host.getType() !== 'http') {
      this.logger.error(
        `Non-HTTP exception in ${host.getType()} context:`,
        exception,
      );
      return;
    }

    let status: number;
    let message: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseBody = exception.getResponse();
      this.logger.warn(responseBody);

      if (typeof responseBody === 'string') {
        message = responseBody;
      } else {
        const rawMessage =
          (responseBody as Record<string, unknown>)['message'] ||
          'Unknown Error';
        // class-validator returns message as string[], join for display
        message = Array.isArray(rawMessage)
          ? rawMessage.join('; ')
          : String(rawMessage);
      }
    } else if (exception?.code === 'FST_REQ_FILE_TOO_LARGE') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'File too large.';
      this.logger.warn(message);
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal Server Error';
      this.logger.error(exception);
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    if (response.sent || response.raw?.headersSent) {
      return;
    }

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
