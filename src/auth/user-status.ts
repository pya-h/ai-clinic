import { Logger } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type UserStatus = Pick<
  User,
  'isActive' | 'isBanned' | 'banReason' | 'role' | 'isAdmin' | 'isSuperAdmin'
>;

const STATUS_SELECT = {
  isActive: true,
  isBanned: true,
  banReason: true,
  role: true,
  isAdmin: true,
  isSuperAdmin: true,
} as const;

/**
 * Process-wide cache of the account fields a session's login-time copy of the user
 * must not be trusted for. Shared by the HTTP guard and the WebSocket gateways.
 */
export class UserStatusCache {
  private static readonly TTL = 60_000;
  private static readonly entries = new Map<string, { status: UserStatus; checkedAt: number }>();
  private static readonly listeners = new Set<(userId: string) => void>();
  private static invalidations = 0;
  private static readonly logger = new Logger(UserStatusCache.name);

  /** Resolves to null when the user does not exist; DB errors are left to the caller. */
  static async get(prisma: PrismaService, userId: string): Promise<UserStatus | null> {
    const now = Date.now();
    const cached = UserStatusCache.entries.get(userId);
    if (cached && now - cached.checkedAt < UserStatusCache.TTL) {
      return cached.status;
    }

    const invalidationsBefore = UserStatusCache.invalidations;
    const status = await prisma.user.findFirst({
      where: { id: userId },
      select: STATUS_SELECT,
    });
    // A read that overlapped an invalidate() may predate the change, so it must not be cached.
    if (status && UserStatusCache.invalidations === invalidationsBefore) {
      UserStatusCache.entries.set(userId, { status, checkedAt: now });
    }
    return status;
  }

  /** Call after changing a user's role, admin flags, ban or active state, so it applies on their next request. */
  static invalidate(userId: string): void {
    UserStatusCache.invalidations++;
    UserStatusCache.entries.delete(userId);
    for (const listener of UserStatusCache.listeners) {
      try {
        listener(userId);
      } catch (err) {
        UserStatusCache.logger.error(
          `Status listener failed for ${userId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }
    }
  }

  /** Returns the unsubscribe function. */
  static onInvalidate(listener: (userId: string) => void): () => void {
    UserStatusCache.listeners.add(listener);
    return () => UserStatusCache.listeners.delete(listener);
  }
}

/** Why the account may not be used, or null when it may. */
export function accountBlockReason(
  status: Pick<UserStatus, 'isActive' | 'isBanned' | 'banReason'>,
): string | null {
  if (status.isBanned) {
    return `Your account has been banned.${status.banReason ? ` Reason: ${status.banReason}` : ''}`;
  }
  if (!status.isActive) {
    return 'Account is deactivated';
  }
  return null;
}
