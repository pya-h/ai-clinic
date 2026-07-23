/**
 * Shared NestJS test app bootstrap helper for E2E tests.
 *
 * Each E2E spec now defines its own trimmed @Module (to avoid importing
 * ThrottlerModule which may not be installed in the test environment).
 * This helper provides utility functions that those specs can share.
 */

import {
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { MockUser } from './mock-session.helper';

/**
 * Helper to inject a simulated session user into Fastify requests for auth testing.
 * Registers a Fastify preHandler hook that sets request.session.
 *
 * NOTE: This adds a hook once. For tests that change the user between requests,
 * use a mutable reference (closure variable) instead, as shown in the E2E specs.
 */
export function injectSessionUser(
  app: NestFastifyApplication,
  user: MockUser | null,
) {
  const instance = app.getHttpAdapter().getInstance();
  instance.addHook('preHandler', (request: any, _reply: any, done: any) => {
    if (user) {
      if (!request.session) {
        request.session = {
          get: (key: string) => (key === 'user' ? user : undefined),
          set: jest.fn(),
          delete: jest.fn(),
        };
      } else {
        const originalGet = request.session.get?.bind(request.session);
        request.session.get = (key: string) => {
          if (key === 'user') return user;
          return originalGet?.(key);
        };
      }
    }
    done();
  });
}
