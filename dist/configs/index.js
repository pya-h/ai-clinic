"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSwagger = void 0;
const config_1 = require("@nestjs/config");
const swagger_1 = require("@nestjs/swagger");
const setupSwagger = (app) => {
    const configService = app.get(config_1.ConfigService);
    const isInDebugMode = configService.get('general.debug'), appPort = configService.getOrThrow('general.appPort'), appName = configService.getOrThrow('general.appName');
    if (isInDebugMode) {
        const config = new swagger_1.DocumentBuilder()
            .setTitle(appName)
            .setDescription(`${appName} API`)
            .setVersion('0.0.1')
            .build();
        const document = swagger_1.SwaggerModule.createDocument(app, config);
        swagger_1.SwaggerModule.setup('docs', app, document);
        console.log(`Swagger docs: http://localhost:${appPort}/docs`);
        console.log(`Swagger docs as JSON: http://localhost:${appPort}/docs-json`);
    }
};
exports.setupSwagger = setupSwagger;
//# sourceMappingURL=index.js.map