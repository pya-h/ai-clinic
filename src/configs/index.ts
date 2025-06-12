import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const setupSwagger = (app: INestApplication) => {
  const configService = app.get<ConfigService>(ConfigService);

  const isInDebugMode = configService.get<boolean>('general.debug'),
    appPort = configService.getOrThrow<number>('general.appPort'),
    appName = configService.getOrThrow<string>('general.appName');

  if (isInDebugMode) {
    // TODO: Make it password protected using basicAuth when app is not in development mode.
    const config = new DocumentBuilder()
      .setTitle(appName)
      .setDescription(`${appName} API`)
      .setVersion('0.0.1')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    console.log(`Swagger docs: http://localhost:${appPort}/docs`);
    console.log(`Swagger docs as JSON: http://localhost:${appPort}/docs-json`);
  }
};
