import { ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CsrfGuard } from './csrf.guard';
import { SKIP_CSRF_KEY, SkipCsrf } from '../decorators/skip-csrf.decorator';

class Routes {
  @SkipCsrf()
  webhook() {}

  plain() {}
}

@SetMetadata(SKIP_CSRF_KEY, true)
class ExemptedRoutes {
  route() {}
}

const token = () => randomBytes(32).toString('hex');

function contextFor(
  request: { method: string; cookies?: Record<string, string>; headers?: Record<string, string> },
  handler: () => void = Routes.prototype.plain,
  cls: object = Routes,
  type = 'http',
): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ headers: {}, ...request }) }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();
  const unsafeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const anyUnsafeMethod = () => unsafeMethods[Math.floor(Math.random() * unsafeMethods.length)];

  it.each(['GET', 'HEAD', 'OPTIONS'])('should let %s through without a token', (method) => {
    expect(guard.canActivate(contextFor({ method }))).toBe(true);
  });

  it.each(unsafeMethods)('should let %s through when the cookie and header tokens match', (method) => {
    const value = token();

    expect(
      guard.canActivate(contextFor({ method, cookies: { 'csrf-token': value }, headers: { 'x-csrf-token': value } })),
    ).toBe(true);
  });

  it.each([
    ['no tokens', {}],
    ['only the cookie', { cookies: { 'csrf-token': token() } }],
    ['only the header', { headers: { 'x-csrf-token': token() } }],
    ['mismatched tokens', { cookies: { 'csrf-token': token() }, headers: { 'x-csrf-token': token() } }],
  ])('should refuse a mutating request with %s (403)', (_case, parts) => {
    expect(() => guard.canActivate(contextFor({ method: anyUnsafeMethod(), ...parts }))).toThrow(
      new ForbiddenException('Invalid or missing CSRF token'),
    );
  });

  it('should skip non-HTTP contexts', () => {
    expect(guard.canActivate(contextFor({ method: 'POST' }, Routes.prototype.plain, Routes, 'ws'))).toBe(true);
  });

  describe('@SkipCsrf()', () => {
    it.each(unsafeMethods)('should let %s through to a decorated handler without a token', (method) => {
      expect(guard.canActivate(contextFor({ method }, Routes.prototype.webhook))).toBe(true);
    });

    it('should still refuse the undecorated handlers of the same controller', () => {
      expect(() => guard.canActivate(contextFor({ method: anyUnsafeMethod() }, Routes.prototype.plain))).toThrow(
        ForbiddenException,
      );
    });

    it('should not exempt a whole controller marked with the metadata', () => {
      expect(() =>
        guard.canActivate(contextFor({ method: anyUnsafeMethod() }, ExemptedRoutes.prototype.route, ExemptedRoutes)),
      ).toThrow(ForbiddenException);
    });
  });
});
