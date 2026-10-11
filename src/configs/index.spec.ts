import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import general from './general';
import { setupSwagger } from '.';

const randomName = () => `Clinic ${Math.random().toString(36).slice(2, 8)}`;

describe('general config', () => {
  const saved = process.env.APP_NAME;

  afterEach(() => {
    if (saved === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = saved;
  });

  it.each([undefined, ''])('should name the app AI-Clinic when APP_NAME is %p', (value) => {
    if (value === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = value;

    expect(general().general.appName).toBe('AI-Clinic');
  });

  it('should use APP_NAME when it is set', () => {
    const name = randomName();
    process.env.APP_NAME = name;

    expect(general().general.appName).toBe(name);
  });
});

describe('setupSwagger', () => {
  let createDocument: jest.SpyInstance;
  let setup: jest.SpyInstance;

  beforeEach(() => {
    createDocument = jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({} as OpenAPIObject);
    setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const appWith = (config: { debug: boolean; appName?: string }) =>
    ({
      get: () =>
        new ConfigService({
          general: { appPort: 1024 + Math.floor(Math.random() * 60000), ...config },
        }),
    }) as unknown as INestApplication;

  it('should not need an app name when Swagger is off', () => {
    expect(() => setupSwagger(appWith({ debug: false }))).not.toThrow();
    expect(createDocument).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it('should serve the docs titled with the app name in debug mode', () => {
    const appName = randomName();
    const app = appWith({ debug: true, appName });

    setupSwagger(app);

    expect(createDocument).toHaveBeenCalledWith(
      app,
      expect.objectContaining({
        info: expect.objectContaining({ title: appName, description: `${appName} API` }),
      }),
    );
    expect(setup).toHaveBeenCalledWith('docs', app, {});
  });
});
