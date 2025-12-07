import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ICacheItemIdentifier } from './types/cache-item-ident.type';
import { Cron, CronExpression } from '@nestjs/schedule';
import { splitIn2, splitIn2Set } from 'src/common/tools/arrays';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  private delEvents: Record<string, (key: string) => Promise<void>> = {};

  private keysWithDelEvent: Set<ICacheItemIdentifier> = new Set(); // using set to prevent multiple instances being pushed on rapid requests.

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
      const kwdi = [...this.keysWithDelEvent].find(
        (i) => i.group === group && i.key === key,
      );
      if (kwdi) {
        kwdi.deadline = new Date(Date.now() + +kwdi.ttl);
      }
    }

    return item;
  }

  set<T>(group: string, key: string, value: T, ttl?: number) {
    if (ttl && this.delEvents[group]) {
      this.keysWithDelEvent.add({
        group,
        key,
        deadline: new Date(Date.now() + +ttl),
        ttl,
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
      items.forEach((item) =>
        this.keysWithDelEvent.add({
          group,
          key: item.k,
          deadline,
          ttl,
        }),
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
      return this.cacheManager.mset(
        withDelEvents.map((i) => {
          this.keysWithDelEvent.add({
            group: i.g,
            key: i.k,
            deadline: new Date(Date.now() + +i.ttl),
            ttl: i.ttl,
          });
          return { key: `${i.g}:${i.k}`, value: i.v };
        }),
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
      this.keysWithDelEvent = new Set(
        [...this.keysWithDelEvent].filter((x) => !keysSet.has(x.key)),
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
      this.keysWithDelEvent = new Set(
        [...this.keysWithDelEvent].filter(
          (x) => !keysSet.has(`${x.group}:${x.key}`),
        ),
      );
    }

    return this.cacheManager.mdel(items.map((i) => `${i.g}:${i.k}`));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkFordelEvents() {
    const exactTime = new Date();
    const [passedDues, remaining] = splitIn2(
      this.keysWithDelEvent,
      (item) => item.deadline < exactTime,
    );
    console.log({ remaining, passedDues });
    this.keysWithDelEvent = new Set(remaining); // TODO: Think about Data_Racing?

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
