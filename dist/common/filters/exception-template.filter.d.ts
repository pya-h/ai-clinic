import { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
export declare class ExceptionTemplateFilter implements ExceptionFilter {
    catch(exception: any, host: ArgumentsHost): void;
}
