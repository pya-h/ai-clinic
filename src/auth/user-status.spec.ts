import { randomUUID } from 'crypto';
import { UserStatusCache, accountBlockReason } from './user-status';

describe('UserStatusCache', () => {
  let prisma: { user: { findFirst: jest.Mock } };

  const status = (overrides: Record<string, unknown> = {}) => ({
    isActive: true,
    isBanned: false,
    banReason: null,
    role: 'PATIENT',
    isAdmin: false,
    isSuperAdmin: false,
    ...overrides,
  });

  beforeEach(() => {
    prisma = { user: { findFirst: jest.fn().mockResolvedValue(status()) } };
    (UserStatusCache as any).entries.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('get', () => {
    it('should read only the status fields of the user', async () => {
      const userId = randomUUID();

      await expect(UserStatusCache.get(prisma as any, userId)).resolves.toEqual(status());
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: userId },
        select: {
          isActive: true,
          isBanned: true,
          banReason: true,
          role: true,
          isAdmin: true,
          isSuperAdmin: true,
        },
      });
    });

    it('should serve repeated reads within 60s from the cache, per user', async () => {
      const [a, b] = [randomUUID(), randomUUID()];

      await UserStatusCache.get(prisma as any, a);
      await UserStatusCache.get(prisma as any, a);
      await UserStatusCache.get(prisma as any, b);

      expect(prisma.user.findFirst).toHaveBeenCalledTimes(2);
    });

    it('should return only the status fields from the cache', async () => {
      const userId = randomUUID();
      await UserStatusCache.get(prisma as any, userId);

      await expect(UserStatusCache.get(prisma as any, userId)).resolves.toStrictEqual(status());
      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should read the DB again once the entry is 60s old', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-08T10:00:00Z') });
      const userId = randomUUID();
      await UserStatusCache.get(prisma as any, userId);

      jest.setSystemTime(new Date('2026-10-08T10:00:59.999Z'));
      await UserStatusCache.get(prisma as any, userId);
      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);

      jest.setSystemTime(new Date('2026-10-08T10:01:00Z'));
      prisma.user.findFirst.mockResolvedValue(status({ isBanned: true }));
      await expect(UserStatusCache.get(prisma as any, userId)).resolves.toMatchObject({ isBanned: true });
      expect(prisma.user.findFirst).toHaveBeenCalledTimes(2);
    });

    it('should not cache a missing user', async () => {
      const userId = randomUUID();
      prisma.user.findFirst.mockResolvedValueOnce(null);

      await expect(UserStatusCache.get(prisma as any, userId)).resolves.toBeNull();
      await expect(UserStatusCache.get(prisma as any, userId)).resolves.toEqual(status());
    });

    it('should propagate DB errors without caching anything', async () => {
      const userId = randomUUID();
      prisma.user.findFirst.mockRejectedValueOnce(new Error('db down'));

      await expect(UserStatusCache.get(prisma as any, userId)).rejects.toThrow('db down');
      await UserStatusCache.get(prisma as any, userId);
      expect(prisma.user.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidate', () => {
    it('should make the next read go to the DB', async () => {
      const userId = randomUUID();
      await UserStatusCache.get(prisma as any, userId);

      UserStatusCache.invalidate(userId);
      prisma.user.findFirst.mockResolvedValue(status({ isAdmin: true }));

      await expect(UserStatusCache.get(prisma as any, userId)).resolves.toMatchObject({ isAdmin: true });
    });

    it('should notify every listener, even when one throws', () => {
      const userId = randomUUID();
      const failing = jest.fn(() => {
        throw new Error('listener bug');
      });
      const other = jest.fn();
      const stopFailing = UserStatusCache.onInvalidate(failing);
      const stopOther = UserStatusCache.onInvalidate(other);

      try {
        expect(() => UserStatusCache.invalidate(userId)).not.toThrow();
        expect(failing).toHaveBeenCalledWith(userId);
        expect(other).toHaveBeenCalledWith(userId);
      } finally {
        stopFailing();
        stopOther();
      }
    });

    it('should stop notifying an unsubscribed listener', () => {
      const listener = jest.fn();
      const stop = UserStatusCache.onInvalidate(listener);

      stop();
      UserStatusCache.invalidate(randomUUID());

      expect(listener).not.toHaveBeenCalled();
    });
  });
});

describe('accountBlockReason', () => {
  it.each([
    [{ isActive: true, isBanned: false, banReason: null }, null],
    [{ isActive: true, isBanned: true, banReason: 'Spam' }, 'Your account has been banned. Reason: Spam'],
    [{ isActive: true, isBanned: true, banReason: null }, 'Your account has been banned.'],
    [{ isActive: false, isBanned: false, banReason: null }, 'Account is deactivated'],
    [{ isActive: false, isBanned: true, banReason: 'Fraud' }, 'Your account has been banned. Reason: Fraud'],
  ])('%o → %p', (status, expected) => {
    expect(accountBlockReason(status)).toBe(expected);
  });
});
