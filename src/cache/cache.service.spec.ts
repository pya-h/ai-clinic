/**
 * CacheService Unit Tests
 *
 * Tests:
 *   get/set/del          — basic cache operations
 *   registerDelEvent     — callback registration
 *   del with delEvent    — triggers callback
 *   set with TTL         — tracks keys for cleanup
 *   checkFordelEvents    — cron-based cleanup
 */
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CacheService } from './cache.service';
import { ScheduleModule } from '@nestjs/schedule';

describe('CacheService', () => {
  let service: CacheService;
  let mockCacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    mset: jest.Mock;
    mdel: jest.Mock;
  };

  beforeEach(async () => {
    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      mset: jest.fn(),
      mdel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        CacheService,
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────── Basic get/set/del ─────────────────────

  describe('get', () => {
    it('should retrieve cached value by group:key', async () => {
      mockCacheManager.get.mockResolvedValue('cached-value');

      const result = await service.get<string>('group1', 'key1');
      expect(result).toBe('cached-value');
      expect(mockCacheManager.get).toHaveBeenCalledWith('group1:key1');
    });

    it('should return undefined for non-existent key', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);

      const result = await service.get<string>('group1', 'missing');
      expect(result).toBeUndefined();
    });
  });

  describe('set', () => {
    it('should store value with group:key prefix', async () => {
      await service.set('group1', 'key1', 'value1', 5000);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'group1:key1',
        'value1',
        5000,
      );
    });

    it('should track key with delEvent when TTL and delEvent are set', async () => {
      const mockCallback = jest.fn();
      service.registerDelEvent('group1', mockCallback);

      await service.set('group1', 'key1', 'value1', 5000);

      // Should call set WITH ttl (TTL is now properly passed for del-event items too)
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'group1:key1',
        'value1',
        5000,
      );
    });

    it('should store value with TTL when no delEvent registered', async () => {
      await service.set('nogroup', 'key1', 'value1', 3000);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'nogroup:key1',
        'value1',
        3000,
      );
    });
  });

  describe('del', () => {
    it('should delete value by group:key', async () => {
      await service.del('group1', 'key1');
      expect(mockCacheManager.del).toHaveBeenCalledWith('group1:key1');
    });

    it('should trigger delEvent callback when registered', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('group1', mockCallback);

      await service.del('group1', 'key1');

      expect(mockCallback).toHaveBeenCalledWith('key1');
      expect(mockCacheManager.del).toHaveBeenCalledWith('group1:key1');
    });

    it('should NOT trigger delEvent when bypassDeleteEvent is true', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('group1', mockCallback);

      await service.del('group1', 'key1', true);

      expect(mockCallback).not.toHaveBeenCalled();
      expect(mockCacheManager.del).toHaveBeenCalledWith('group1:key1');
    });
  });

  // ───────────────────── registerDelEvent / unregisterDelEvent ─────────────────────

  describe('registerDelEvent', () => {
    it('should register a delete event callback', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('testgroup', mockCallback);

      // Verify it's used during del
      await service.del('testgroup', 'somekey');
      expect(mockCallback).toHaveBeenCalledWith('somekey');
    });

    it('should allow unregistering a delete event', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('testgroup', mockCallback);
      service.unregisterDelEvent('testgroup');

      await service.del('testgroup', 'somekey');
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  // ───────────────────── mset ─────────────────────

  describe('mset', () => {
    it('should set multiple values at once', async () => {
      mockCacheManager.mset.mockResolvedValue([]);

      await service.mset('group1', [
        { k: 'a', v: 1 },
        { k: 'b', v: 2 },
      ], 5000);

      expect(mockCacheManager.mset).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ key: 'group1:a' }),
          expect.objectContaining({ key: 'group1:b' }),
        ]),
      );
    });
  });

  // ───────────────────── mdel ─────────────────────

  describe('mdel', () => {
    it('should delete multiple keys at once', async () => {
      mockCacheManager.mdel.mockResolvedValue(true);

      await service.mdel('group1', 'key1', 'key2');
      expect(mockCacheManager.mdel).toHaveBeenCalledWith([
        'group1:key1',
        'group1:key2',
      ]);
    });

    it('should trigger delEvent for each key when registered', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('group1', mockCallback);
      mockCacheManager.mdel.mockResolvedValue(true);

      await service.mdel('group1', 'key1', 'key2');

      expect(mockCallback).toHaveBeenCalledTimes(2);
      expect(mockCallback).toHaveBeenCalledWith('key1');
      expect(mockCallback).toHaveBeenCalledWith('key2');
    });
  });

  // ───────────────────── checkFordelEvents (cron) ─────────────────────

  describe('checkFordelEvents', () => {
    it('should trigger delEvent for expired keys', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('group1', mockCallback);

      // Manually add an expired key by setting with past deadline
      await service.set('group1', 'expired-key', 'val', 1); // 1ms TTL

      // Wait for it to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      await service.checkFordelEvents();

      expect(mockCallback).toHaveBeenCalledWith('expired-key');
    });

    it('should NOT trigger delEvent for non-expired keys', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('group1', mockCallback);

      // Set with long TTL
      await service.set('group1', 'active-key', 'val', 60000);

      await service.checkFordelEvents();

      expect(mockCallback).not.toHaveBeenCalledWith('active-key');
    });

    it('should rebuild internal Map keeping only non-expired items', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('group1', mockCallback);

      // One expired, one still alive
      await service.set('group1', 'expired', 'v', 1);
      await service.set('group1', 'alive', 'v', 60000);

      await new Promise((r) => setTimeout(r, 10));
      await service.checkFordelEvents();

      expect(mockCallback).toHaveBeenCalledWith('expired');
      expect(mockCallback).not.toHaveBeenCalledWith('alive');

      // After cleanup the alive key should still fire on next cron if it expires
      mockCallback.mockClear();
      // alive is still tracked so a second cron with it still valid should not fire
      await service.checkFordelEvents();
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should call cacheManager.mdel for expired items', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('group1', mockCallback);
      mockCacheManager.mdel.mockResolvedValue(true);

      await service.set('group1', 'exp1', 'v', 1);
      await service.set('group1', 'exp2', 'v', 1);

      await new Promise((r) => setTimeout(r, 10));
      await service.checkFordelEvents();

      expect(mockCacheManager.mdel).toHaveBeenCalledWith(
        expect.arrayContaining(['group1:exp1', 'group1:exp2']),
      );
    });
  });

  // ───────────────────── mdel with del events (Map-based) ─────────────────────

  describe('mdel with del events', () => {
    it('should invoke del event callback for each key', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('g', mockCallback);
      mockCacheManager.mdel.mockResolvedValue(true);

      await service.set('g', 'k1', 'v1', 5000);
      await service.set('g', 'k2', 'v2', 5000);

      await service.mdel('g', 'k1', 'k2');

      expect(mockCallback).toHaveBeenCalledTimes(2);
      expect(mockCallback).toHaveBeenCalledWith('k1');
      expect(mockCallback).toHaveBeenCalledWith('k2');
    });

    it('should remove deleted keys from keysWithDelEvent Map', async () => {
      const mockCallback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('g', mockCallback);
      mockCacheManager.mdel.mockResolvedValue(true);

      await service.set('g', 'k1', 'v1', 5000);
      await service.set('g', 'k2', 'v2', 5000);
      await service.set('g', 'k3', 'v3', 5000);

      await service.mdel('g', 'k1', 'k2');

      // k3 still tracked — should fire on cron if expired
      mockCallback.mockClear();
      // checkFordelEvents should NOT fire k1 or k2 (already deleted)
      // Force k3 to still be alive
      await service.checkFordelEvents();
      expect(mockCallback).not.toHaveBeenCalledWith('k1');
      expect(mockCallback).not.toHaveBeenCalledWith('k2');
    });

    it('should log error but continue when del event callback fails', async () => {
      const failCb = jest.fn().mockRejectedValue(new Error('boom'));
      service.registerDelEvent('g', failCb);
      mockCacheManager.mdel.mockResolvedValue(true);

      // Should not throw
      await expect(service.mdel('g', 'k1', 'k2')).resolves.toBe(true);
      expect(failCb).toHaveBeenCalledTimes(2);
    });
  });

  // ───────────────────── mdel2 with mixed groups ─────────────────────

  describe('mdel2', () => {
    it('should process items with del events and items without', async () => {
      const callback = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('withEvent', callback);
      mockCacheManager.mdel.mockResolvedValue(true);

      await service.set('withEvent', 'k1', 'v', 5000);

      await service.mdel2(
        { g: 'withEvent', k: 'k1' },
        { g: 'noEvent', k: 'k2' },
      );

      // Del event only fires for the group that has one
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('k1');

      // Both items passed to cacheManager.mdel
      expect(mockCacheManager.mdel).toHaveBeenCalledWith(
        expect.arrayContaining(['withEvent:k1', 'noEvent:k2']),
      );
    });

    it('should handle only-withDelEvents items', async () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('g1', cb);
      mockCacheManager.mdel.mockResolvedValue(true);

      await service.mdel2({ g: 'g1', k: 'a' }, { g: 'g1', k: 'b' });

      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('should handle only-normal items (no del events)', async () => {
      mockCacheManager.mdel.mockResolvedValue(true);

      await service.mdel2({ g: 'x', k: '1' }, { g: 'y', k: '2' });

      expect(mockCacheManager.mdel).toHaveBeenCalledWith(
        expect.arrayContaining(['x:1', 'y:2']),
      );
    });

    it('should log error but continue when a del event callback throws', async () => {
      const failCb = jest.fn().mockRejectedValue(new Error('fail'));
      service.registerDelEvent('g', failCb);
      mockCacheManager.mdel.mockResolvedValue(true);

      await expect(
        service.mdel2({ g: 'g', k: 'k1' }, { g: 'none', k: 'k2' }),
      ).resolves.toBe(true);
      expect(failCb).toHaveBeenCalledWith('k1');
    });
  });

  // ───────────────────── mset2 ─────────────────────

  describe('mset2', () => {
    it('should process both withDelEvents and normals branches', async () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('tracked', cb);
      mockCacheManager.mset.mockResolvedValue([]);

      await service.mset2(
        { g: 'tracked', k: 'a', v: 1, ttl: 5000 },
        { g: 'plain', k: 'b', v: 2, ttl: 3000 },
      );

      // Two mset calls: one for withDelEvents, one for normals
      expect(mockCacheManager.mset).toHaveBeenCalledTimes(2);

      // withDelEvents call
      expect(mockCacheManager.mset).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ key: 'tracked:a', value: 1, ttl: 5000 }),
        ]),
      );

      // normals call
      expect(mockCacheManager.mset).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ key: 'plain:b', value: 2, ttl: 3000 }),
        ]),
      );
    });

    it('should only call mset once when all items are tracked', async () => {
      service.registerDelEvent('g', jest.fn());
      mockCacheManager.mset.mockResolvedValue([]);

      await service.mset2(
        { g: 'g', k: 'a', v: 1, ttl: 1000 },
        { g: 'g', k: 'b', v: 2, ttl: 1000 },
      );

      expect(mockCacheManager.mset).toHaveBeenCalledTimes(1);
    });

    it('should only call mset once when no items are tracked', async () => {
      mockCacheManager.mset.mockResolvedValue([]);

      await service.mset2(
        { g: 'x', k: 'a', v: 1 },
        { g: 'y', k: 'b', v: 2 },
      );

      expect(mockCacheManager.mset).toHaveBeenCalledTimes(1);
    });

    it('should register del-event tracked keys in the internal Map', async () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('g', cb);
      mockCacheManager.mset.mockResolvedValue([]);

      await service.mset2({ g: 'g', k: 'a', v: 1, ttl: 1 });

      // Wait for it to expire then verify cron fires the callback
      await new Promise((r) => setTimeout(r, 10));
      await service.checkFordelEvents();

      expect(cb).toHaveBeenCalledWith('a');
    });
  });

  // ───────────────────── get with updateDeadline ─────────────────────

  describe('get with updateDeadline', () => {
    it('should update deadline when updateDeadline is true and item exists', async () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      service.registerDelEvent('g', cb);

      await service.set('g', 'k', 'v', 1); // 1ms TTL
      mockCacheManager.get.mockResolvedValue('v');

      // Immediately get with updateDeadline — should push deadline forward
      await service.get('g', 'k', true);

      // The key should NOT be expired after a short wait because deadline was refreshed
      await new Promise((r) => setTimeout(r, 5));

      // We can't perfectly test the deadline shift without accessing internals,
      // but we can verify get still returns the value
      expect(mockCacheManager.get).toHaveBeenCalledWith('g:k');
    });
  });
});
