/**
 * Guards Unit Tests
 *
 * Covers all 5 auth guards:
 *   - CookieAuthGuard   — session-based authentication (Fastify)
 *   - AdminGuard         — admin / superAdmin check
 *   - RolesGuard         — role-based access via Reflector
 *   - SuperAdminGuard    — superAdmin-only check
 *   - OptionalAuthGuard  — optional session (guest-friendly)
 */
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CookieAuthGuard } from './cookie-auth.guard';
import { AdminGuard } from './admin.guard';
import { RolesGuard } from './roles.guard';
import { SuperAdminGuard } from './super-admin.guard';
import { OptionalAuthGuard } from './optional-auth.guard';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal Fastify-style ExecutionContext mock */
function createMockContext(
  sessionUser: Record<string, any> | null | undefined,
  requestUser?: Record<string, any>,
): ExecutionContext {
  const request: Record<string, any> = {
    session: {
      get: jest.fn((key: string) => {
        if (key === 'user') return sessionUser;
        return undefined;
      }),
    },
  };
  if (requestUser !== undefined) {
    request.user = requestUser;
  }
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;
}

// ═════════════════════════════════════════════════════════════════════════════════
// CookieAuthGuard
// ═════════════════════════════════════════════════════════════════════════════════

describe('CookieAuthGuard', () => {
  let guard: CookieAuthGuard;

  beforeEach(() => {
    guard = new CookieAuthGuard();
  });

  it('should throw UnauthorizedException when no session user', () => {
    const ctx = createMockContext(null);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Not authenticated');
  });

  it('should throw UnauthorizedException when session is undefined', () => {
    // Simulate a request with no session object at all
    const request: Record<string, any> = {};
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw ForbiddenException when user is inactive', () => {
    const ctx = createMockContext({ id: 1, isActive: false });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Account is deactivated');
  });

  it('should set request.user and return true for valid active session', () => {
    const user = { id: 1, isActive: true, role: 'PATIENT' };
    const ctx = createMockContext(user);
    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toEqual(user);
  });

  it('should pass when isActive is not explicitly false (undefined)', () => {
    const user = { id: 2, role: 'DOCTOR' };
    const ctx = createMockContext(user);
    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toEqual(user);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// AdminGuard
// ═════════════════════════════════════════════════════════════════════════════════

describe('AdminGuard', () => {
  let guard: AdminGuard;

  beforeEach(() => {
    guard = new AdminGuard();
  });

  it('should throw ForbiddenException when no user on request', () => {
    const ctx = createMockContext(null);
    // AdminGuard reads request.user (set by CookieAuthGuard), not session
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Admin access required.');
  });

  it('should throw ForbiddenException for non-admin user', () => {
    const ctx = createMockContext(null, { id: 1, isAdmin: false, isSuperAdmin: false });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should return true for admin user', () => {
    const ctx = createMockContext(null, { id: 1, isAdmin: true, isSuperAdmin: false });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should return true for superAdmin user', () => {
    const ctx = createMockContext(null, { id: 1, isAdmin: false, isSuperAdmin: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// RolesGuard
// ═════════════════════════════════════════════════════════════════════════════════

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('should return true when no roles metadata is defined', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = createMockContext(null);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when roles required but no user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['PATIENT']);
    const ctx = createMockContext(null); // no request.user set
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Authentication required');
  });

  it('should return true when user has the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['PATIENT']);
    const ctx = createMockContext(null, {
      id: 1,
      role: 'PATIENT',
      isAdmin: false,
      isSuperAdmin: false,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when user has wrong role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DOCTOR']);
    const ctx = createMockContext(null, {
      id: 1,
      role: 'PATIENT',
      isAdmin: false,
      isSuperAdmin: false,
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Insufficient role');
  });

  it('should return true for admin user regardless of role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DOCTOR']);
    const ctx = createMockContext(null, {
      id: 1,
      role: 'PATIENT',
      isAdmin: true,
      isSuperAdmin: false,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should return true for superAdmin user regardless of role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DOCTOR']);
    const ctx = createMockContext(null, {
      id: 1,
      role: 'PATIENT',
      isAdmin: false,
      isSuperAdmin: true,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// SuperAdminGuard
// ═════════════════════════════════════════════════════════════════════════════════

describe('SuperAdminGuard', () => {
  let guard: SuperAdminGuard;

  beforeEach(() => {
    guard = new SuperAdminGuard();
  });

  it('should throw ForbiddenException when no user on request', () => {
    const ctx = createMockContext(null);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Superadmin access required');
  });

  it('should throw ForbiddenException for non-superAdmin user', () => {
    const ctx = createMockContext(null, { id: 1, isSuperAdmin: false });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should return true for superAdmin user', () => {
    const ctx = createMockContext(null, { id: 1, isSuperAdmin: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// OptionalAuthGuard
// ═════════════════════════════════════════════════════════════════════════════════

describe('OptionalAuthGuard', () => {
  let guard: OptionalAuthGuard;

  beforeEach(() => {
    guard = new OptionalAuthGuard();
  });

  it('should set request.user to null and return true when no session user', () => {
    const ctx = createMockContext(null);
    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toBeNull();
  });

  it('should set request.user to null when session is undefined', () => {
    const request: Record<string, any> = {};
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    const result = guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(request.user).toBeNull();
  });

  it('should set request.user to session user when valid session exists', () => {
    const user = { id: 1, role: 'PATIENT', isActive: true };
    const ctx = createMockContext(user);
    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toEqual(user);
  });
});
