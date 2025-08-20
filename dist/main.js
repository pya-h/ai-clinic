"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const exception_template_filter_1 = require("./common/filters/exception-template.filter");
const response_template_interceptor_1 = require("./common/interceptors/response-template.interceptor");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_fastify_1.FastifyAdapter());
    app.enableCors();
    app.useGlobalFilters(new exception_template_filter_1.ExceptionTemplateFilter());
    app.useGlobalInterceptors(new response_template_interceptor_1.ResponseTemplateInterceptor());
    const configService = app.get(config_1.ConfigService);
    const appPort = configService.getOrThrow('general.appPort'), appIsInDebugMode = configService.get('general.debug');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidUnknownValues: true,
        transform: true,
        enableDebugMessages: appIsInDebugMode,
    }));
    await app.listen(appPort ?? 8080);
}
bootstrap();
//# sourceMappingURL=main.js.map