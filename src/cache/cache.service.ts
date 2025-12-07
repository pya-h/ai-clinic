import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ICacheItemIdentifier } from './types/cache-item-ident.type';
import { Cron, CronExpression } from '@nestjs/schedule';
import { splitIn2 } from 'src/common/tools/arrays';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  private delEvents: Record<string, (key: string) => Promise<void>> = {};

  private keysWithDelEvent: ICacheItemIdentifier[] = [];

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  registerDelEvent(group: string, action: (key: string) => Promise<void>) {
    this.delEvents[group] = action;
  }

  unregisterDelEvent(group: string) {
    delete this.delEvents[group];
  }

  get<T>(group: string, key: string) {
    return this.cacheManager.get<T>(`${group}:${key}`);
  }

  set<T>(group: string, key: string, value: T, ttl?: number) {
    if (ttl && this.delEvents[group]) {
      this.keysWithDelEvent.push({
        group,
        key,
        deadline: new Date(Date.now() + +ttl),
      });
      return this.cacheManager.set<T>(`${group}:${key}`, value);
    }
    return this.cacheManager.set<T>(`${group}:${key}`, value, ttl);
  }

  async mset<T>(
    group: string,
    items: { k: string; v: T }[],
    ttl?: number,
  ): Promise<{ key: string; value: T }[]> {
    if (this.delEvents[group]) {
      const deadline = new Date(Date.now() + +ttl);
      this.keysWithDelEvent.push(
        ...items.map((item) => ({
          group,
          key: item.k,
          deadline,
        })),
      );
      return this.cacheManager.mset(
        items.map((i) => ({ key: `${group}:${i.k}`, value: i.v })),
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
    if (withDelEvents?.length) {
      this.keysWithDelEvent.push(
        ...withDelEvents.map((item) => ({
          group: item.g,
          key: item.k,
          deadline: new Date(Date.now() + +item.ttl),
        })),
      );
      return this.cacheManager.mset(
        withDelEvents.map((i) => ({ key: `${i.g}:${i.k}`, value: i.v })),
      );
    }

    if (normals?.length) {
      return this.cacheManager.mset(
        normals.map((i) => ({ key: `${i.g}:${i.k}`, value: i.v, ttl: i.ttl })),
      );
    }
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
      this.keysWithDelEvent = this.keysWithDelEvent.filter(
        (x) => !keysSet.has(x.key),
      );
    }
    return this.cacheManager.mdel(keys.map((k) => `${group}:${k}`));
  }

  async mdel2(...items: { g: string; k: string }[]): Promise<boolean> {
    const [withDelEvents, normals] = splitIn2(
      items,
      (item) => item.g in this.delEvents,
    );
    if (withDelEvents?.length) {
      const rawKeys = await Promise.all(
        items.map(async (item) => {
          try {
            await this.delEvents[item.g](item.k);
          } catch (error) {
            this.logger.error(
              `Failed to execute TTL event for ${item.g}:${item.k}:`,
              error,
            );
          }
          return `${item.g}:${item.k}`;
        }),
      );
      const keysSet = new Set(rawKeys);
      this.keysWithDelEvent = this.keysWithDelEvent.filter(
        (x) => !keysSet.has(`${x.group}:${x.key}`),
      );
    }

    return this.cacheManager.mdel(items.map((i) => `${i.g}:${i.k}`));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkFordelEvents() {
    const exactTime = new Date();
    const [passedDues, remaining] = splitIn2(
      this.keysWithDelEvent,
      (item) => item.deadline >= exactTime,
    );
    this.keysWithDelEvent = remaining; // TODO: Think about Data_Racing?

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
    await this.cacheManager.mdel(
      passedDues.map((item) => `${item.group}:${item.key}`),
    );
  }
}
