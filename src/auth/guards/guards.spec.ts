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
import { UserStatusCache } from '../user-status';
import { randomUuid } from '../../../test/helpers/test-data.factory';

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
      set: jest.fn(),
      delete: jest.fn(),
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
    const ctx = createMockContext({ id: randomUuid(), isActive: false });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Account is deactivated');
  });

  it('should set request.user and return true for valid active session', () => {
    const user = { id: randomUuid(), isActive: true, role: 'PATIENT' };
    const ctx = createMockContext(user);
    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toEqual(user);
  });

  it('should pass when isActive is not explicitly false (undefined)', () => {
    const user = { id: randomUuid(), role: 'DOCTOR' };
    const ctx = createMockContext(user);
    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toEqual(user);
  });

  describe('with PrismaService (DB verification)', () => {
    let guardWithPrisma: CookieAuthGuard;
    let mockPrisma: any;

    beforeEach(() => {
      mockPrisma = {
        user: {
          findFirst: jest.fn(),
        },
      };
      guardWithPrisma = new CookieAuthGuard(mockPrisma);
      (UserStatusCache as any).entries.clear();
    });

    const dbStatus = (overrides: Record<string, unknown> = {}) => ({
      isActive: true,
      isBanned: false,
      banReason: null,
      role: 'PATIENT',
      isAdmin: false,
      isSuperAdmin: false,
      ...overrides,
    });

    const sessionUser = (overrides: Record<string, unknown> = {}) => ({
      id: randomUuid(),
      isActive: true,
      role: 'PATIENT',
      isAdmin: false,
      isSuperAdmin: false,
      ...overrides,
    });

    const requestOf = (ctx: ExecutionContext) => ctx.switchToHttp().getRequest() as any;

    it('should verify user status from DB and return true for active user', async () => {
      const user = sessionUser();
      mockPrisma.user.findFirst.mockResolvedValue(dbStatus());
      const ctx = createMockContext(user);

      const result = await guardWithPrisma.canActivate(ctx);
      expect(result).toBe(true);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: user.id },
        }),
      );
    });

    it('should throw ForbiddenException when DB shows user is banned', async () => {
      const user = { id: randomUuid(), isActive: true, role: 'PATIENT' };
      mockPrisma.user.findFirst.mockResolvedValue({ isActive: true, isBanned: true, banReason: 'spam' });
      const ctx = createMockContext(user);

      await expect(guardWithPrisma.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when DB shows user is deactivated', async () => {
      const user = { id: randomUuid(), isActive: true, role: 'PATIENT' };
      mockPrisma.user.findFirst.mockResolvedValue({ isActive: false, isBanned: false, banReason: null });
      const ctx = createMockContext(user);

      await expect(guardWithPrisma.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('should log warning and return true when user not found in DB', async () => {
      const user = { id: randomUuid(), isActive: true, role: 'PATIENT' };
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const ctx = createMockContext(user);

      const result = await guardWithPrisma.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('should fall through on DB error (trust session)', async () => {
      const user = { id: randomUuid(), isActive: true, role: 'PATIENT' };
      mockPrisma.user.findFirst.mockRejectedValue(new Error('DB connection lost'));
      const ctx = createMockContext(user);

      const result = await guardWithPrisma.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('should use cached status within TTL and skip DB query', async () => {
      const user = sessionUser();
      mockPrisma.user.findFirst.mockResolvedValue(dbStatus());

      const ctx1 = createMockContext(user);
      await guardWithPrisma.canActivate(ctx1);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);

      const ctx2 = createMockContext(user);
      await guardWithPrisma.canActivate(ctx2);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should keep the session untouched when role and admin flags match the DB', async () => {
      const user = sessionUser({ role: 'DOCTOR' });
      mockPrisma.user.findFirst.mockResolvedValue(dbStatus({ role: 'DOCTOR' }));
      const ctx = createMockContext(user);

      await guardWithPrisma.canActivate(ctx);

      expect(requestOf(ctx).user).toBe(user);
      expect(requestOf(ctx).session.set).not.toHaveBeenCalled();
    });

    it('should strip admin rights from a demoted admin and save that in the session', async () => {
      const user = sessionUser({ role: 'NONE', isAdmin: true });
      mockPrisma.user.findFirst.mockResolvedValue(dbStatus({ role: 'NONE', isAdmin: false }));
      const ctx = createMockContext(user);

      await guardWithPrisma.canActivate(ctx);

      const refreshed = { ...user, isAdmin: false };
      expect(requestOf(ctx).user).toEqual(refreshed);
      expect(requestOf(ctx).session.set).toHaveBeenCalledWith('user', refreshed);
      expect(() => new AdminGuard().canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should apply a role change made after login', async () => {
      const user = sessionUser({ role: 'PATIENT' });
      mockPrisma.user.findFirst.mockResolvedValue(dbStatus({ role: 'NURSE' }));
      const ctx = createMockContext(user);

      await guardWithPrisma.canActivate(ctx);

      expect(requestOf(ctx).user.role).toBe('NURSE');
      expect(requestOf(ctx).user.id).toBe(user.id);
    });

    it.each([
      ['isAdmin', { isAdmin: true }],
      ['isSuperAdmin', { isAdmin: true, isSuperAdmin: true }],
    ])('should grant %s gained after login', async (_flag, flags) => {
      const user = sessionUser();
      mockPrisma.user.findFirst.mockResolvedValue(dbStatus(flags));
      const ctx = createMockContext(user);

      await guardWithPrisma.canActivate(ctx);

      expect(requestOf(ctx).user).toEqual({ ...user, ...flags });
    });

    it('should refresh from the cached status too', async () => {
      const user = sessionUser({ isAdmin: true });
      mockPrisma.user.findFirst.mockResolvedValue(dbStatus({ isAdmin: false }));

      await guardWithPrisma.canActivate(createMockContext({ ...user, isAdmin: false }));
      const ctx = createMockContext(user);
      await guardWithPrisma.canActivate(ctx);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
      expect(requestOf(ctx).user.isAdmin).toBe(false);
    });

    it('should re-read the DB after UserStatusCache.invalidate instead of waiting for the TTL', async () => {
      const user = sessionUser({ role: 'NONE', isAdmin: true });
      mockPrisma.user.findFirst.mockResolvedValueOnce(dbStatus({ role: 'NONE', isAdmin: true }));
      await guardWithPrisma.canActivate(createMockContext(user));

      mockPrisma.user.findFirst.mockResolvedValueOnce(dbStatus({ role: 'NONE', isAdmin: false }));
      const staleCtx = createMockContext(user);
      await guardWithPrisma.canActivate(staleCtx);
      expect(requestOf(staleCtx).user.isAdmin).toBe(true);

      UserStatusCache.invalidate(user.id);
      const ctx = createMockContext(user);
      await guardWithPrisma.canActivate(ctx);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);
      expect(requestOf(ctx).user.isAdmin).toBe(false);
    });

    it('should apply a ban right after UserStatusCache.invalidate', async () => {
      const user = sessionUser();
      mockPrisma.user.findFirst.mockResolvedValueOnce(dbStatus());
      await guardWithPrisma.canActivate(createMockContext(user));

      mockPrisma.user.findFirst.mockResolvedValueOnce(dbStatus({ isBanned: true, banReason: 'abuse' }));
      UserStatusCache.invalidate(user.id);
      const ctx = createMockContext(user);

      await expect(guardWithPrisma.canActivate(ctx)).rejects.toThrow('Reason: abuse');
      expect(requestOf(ctx).session.delete).toHaveBeenCalled();
    });

    it('should leave the session user in place when the DB is unreachable', async () => {
      const user = sessionUser({ isAdmin: true });
      mockPrisma.user.findFirst.mockRejectedValue(new Error('DB connection lost'));
      const ctx = createMockContext(user);

      await guardWithPrisma.canActivate(ctx);

      expect(requestOf(ctx).user).toBe(user);
      expect(requestOf(ctx).session.set).not.toHaveBeenCalled();
    });
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
    const ctx = createMockContext(null, { id: randomUuid(), isAdmin: false, isSuperAdmin: false });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should return true for admin user', () => {
    const ctx = createMockContext(null, { id: randomUuid(), isAdmin: true, isSuperAdmin: false });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should return true for superAdmin user', () => {
    const ctx = createMockContext(null, { id: randomUuid(), isAdmin: false, isSuperAdmin: true });
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

  it('should throw UnauthorizedException when roles required but no user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['PATIENT']);
    const ctx = createMockContext(null); // no request.user set
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow('Authentication required');
  });

  it('should return true when user has the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['PATIENT']);
    const ctx = createMockContext(null, {
      id: randomUuid(),
      role: 'PATIENT',
      isAdmin: false,
      isSuperAdmin: false,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when user has wrong role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DOCTOR']);
    const ctx = createMockContext(null, {
      id: randomUuid(),
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
      id: randomUuid(),
      role: 'PATIENT',
      isAdmin: true,
      isSuperAdmin: false,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should return true for superAdmin user regardless of role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DOCTOR']);
    const ctx = createMockContext(null, {
      id: randomUuid(),
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
    const ctx = createMockContext(null, { id: randomUuid(), isSuperAdmin: false });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should return true for superAdmin user', () => {
    const ctx = createMockContext(null, { id: randomUuid(), isSuperAdmin: true });
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
    const user = { id: randomUuid(), role: 'PATIENT', isActive: true };
    const ctx = createMockContext(user);
    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toEqual(user);
  });
});
