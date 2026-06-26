import { WsException } from '@nestjs/websockets';

interface RateBucket {
  count: number;
  resetAt: number;
}

export class WsRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number = 10_000,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), windowMs * 2);
  }

  check(userId: string, event: string): void {
    const key = `${userId}:${event}`;
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }

    bucket.count++;
    if (bucket.count > this.maxPerWindow) {
      throw new WsException(`Rate limit exceeded for ${event}`);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buckets.clear();
  }
}
