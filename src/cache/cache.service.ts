import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ICacheItemIdentifier } from './types/cache-item-ident.type';
import { Cron, CronExpression } from '@nestjs/schedule';
import { splitIn2 } from '../common/tools/arrays';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  private delEvents: Record<string, (key: string) => Promise<void>> = {};

  /**
   * Map-based tracking for del-event items. Key format: "group:key"
   * Using Map instead of Set<object> because Set uses reference equality,
   * so identical {group,key} objects would never deduplicate.
   */
  private keysWithDelEvent: Map<string, ICacheItemIdentifier> = new Map();

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  registerDelEvent(group: string, action: (key: string) => Promise<void>) {
    this.delEvents[group] = action;
  }

  unregisterDelEvent(group: string) {
    delete this.delEvents[group];
  }

  async get<T>(group: string, key: string, updateDeadline?: boolean) {
    const item = await this.cacheManager.get<T>(`${group}:${key}`);
    if (updateDeadline && item && this.delEvents?.[group]) {
      const mapKey = `${group}:${key}`;
      const kwdi = this.keysWithDelEvent.get(mapKey);
      if (kwdi) {
        kwdi.deadline = new Date(Date.now() + (+kwdi.ttl || 0));
      }
    }

    return item;
  }

  set<T>(group: string, key: string, value: T, ttl?: number) {
    if (ttl && this.delEvents[group]) {
      const mapKey = `${group}:${key}`;
      this.keysWithDelEvent.set(mapKey, {
        group,
        key,
        deadline: new Date(Date.now() + ttl),
        ttl,
      });
      return this.cacheManager.set<T>(`${group}:${key}`, value, ttl);
    }
    return this.cacheManager.set<T>(`${group}:${key}`, value, ttl);
  }

  async mset<T>(
    group: string,
    items: { k: string; v: T }[],
    ttl?: number,
  ): Promise<{ key: string; value: T }[]> {
    if (this.delEvents[group]) {
      const deadline = new Date(Date.now() + (+ttl || 0));
      items.forEach((item) => {
        const mapKey = `${group}:${item.k}`;
        this.keysWithDelEvent.set(mapKey, {
          group,
          key: item.k,
          deadline,
          ttl,
        });
      });
      return this.cacheManager.mset(
        items.map((i) => ({ key: `${group}:${i.k}`, value: i.v, ttl })),
      );
    }
    return this.cacheManager.mset(
      items.map((i) => ({ key: `${group}:${i.k}`, value: i.v, ttl })),
    );
  }

  async mset2<T>(
    ...items: { g: string; k: string; v: T; ttl?: number }[]
  ): Promise<{ key: string; value: T; ttl?: number }[]> {
    const [withDelEvents, normals] = splitIn2(
      items,
      (item) => item.g in this.delEvents,
    );
    const results: { key: string; value: T; ttl?: number }[][] = [];

    if (withDelEvents?.length) {
      results.push(
        await this.cacheManager.mset(
          withDelEvents.map((i) => {
            const mapKey = `${i.g}:${i.k}`;
            this.keysWithDelEvent.set(mapKey, {
              group: i.g,
              key: i.k,
              deadline: new Date(Date.now() + (+i.ttl || 0)),
              ttl: i.ttl,
            });
            return { key: `${i.g}:${i.k}`, value: i.v, ttl: i.ttl };
          }),
        ),
      );
    }

    if (normals?.length) {
      results.push(
        await this.cacheManager.mset(
          normals.map((i) => ({ key: `${i.g}:${i.k}`, value: i.v, ttl: i.ttl })),
        ),
      );
    }

    return results.flat();
  }

  async del(group: string, key: string, bypassDeleteEvent?: boolean) {
    if (this.delEvents[group] && !bypassDeleteEvent) {
      await this.delEvents[group](key);
    }
    return this.cacheManager.del(`${group}:${key}`);
  }

  async mdel(group: string, ...keys: string[]): Promise<boolean> {
    if (this.delEvents[group]) {
      const action = this.delEvents[group];

      await Promise.all(
        keys.map(async (key) => {
          try {
            await action(key);
          } catch (error) {
            this.logger.error(
              `Failed to execute TTL event for ${group}:${key}:`,
              error,
            );
          }
        }),
      );
      const keysSet = new Set(keys);
      for (const [mapKey, item] of this.keysWithDelEvent) {
        if (keysSet.has(item.key)) {
          this.keysWithDelEvent.delete(mapKey);
        }
      }
    }
    return this.cacheManager.mdel(keys.map((k) => `${group}:${k}`));
  }

  async mdel2(...items: { g: string; k: string }[]): Promise<boolean> {
    const [withDelEvents, normals] = splitIn2(
      items,
      (item) => item.g in this.delEvents,
    );
    if (withDelEvents?.length) {
      await Promise.all(
        withDelEvents.map(async (item) => {
          try {
            await this.delEvents[item.g](item.k);
          } catch (error) {
            this.logger.error(
              `Failed to execute TTL event for ${item.g}:${item.k}:`,
              error,
            );
          }
        }),
      );
      for (const item of withDelEvents) {
        this.keysWithDelEvent.delete(`${item.g}:${item.k}`);
      }
    }

    return this.cacheManager.mdel(items.map((i) => `${i.g}:${i.k}`));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkFordelEvents() {
    const exactTime = new Date();
    const allValues = [...this.keysWithDelEvent.values()];
    const [passedDues, remaining] = splitIn2(
      allValues,
      (item) => item.deadline < exactTime,
    );
    // Rebuild Map from remaining items
    const newMap = new Map<string, ICacheItemIdentifier>();
    for (const item of remaining) {
      newMap.set(`${item.group}:${item.key}`, item);
    }
    this.keysWithDelEvent = newMap;

    await Promise.all(
      passedDues.map(async (item) => {
        try {
          await this.delEvents[item.group](item.key);
        } catch (error) {
          this.logger.error(
            `Failed to execute TTL event for ${item.group}:${item.key}:`,
            error,
          );
        }
      }),
    );
    if (passedDues.length) {
      await this.cacheManager.mdel(
        passedDues.map((item) => `${item.group}:${item.key}`),
      );
    }
  }
}
