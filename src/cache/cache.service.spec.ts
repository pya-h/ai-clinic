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

      // Should call set WITHOUT ttl (managed internally)
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'group1:key1',
        'value1',
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
  });
});
