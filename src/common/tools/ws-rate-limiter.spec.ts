import { WsException } from '@nestjs/websockets';
import { randomInt } from 'crypto';
import { WsRateLimiter } from './ws-rate-limiter';

describe('WsRateLimiter', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows up to maxPerWindow requests per user+event and throws WsException afterward', () => {
    jest.useFakeTimers();
    const limit = randomInt(2, 6);
    const limiter = new WsRateLimiter(limit, 5_000);

    for (let i = 0; i < limit; i++) {
      expect(() => limiter.check('user-1', 'chat:send')).not.toThrow();
    }

    expect(() => limiter.check('user-1', 'chat:send')).toThrow(
      new WsException('Rate limit exceeded for chat:send'),
    );
    // separate event/user bucket stays unaffected
    expect(() => limiter.check('user-1', 'chat:join')).not.toThrow();
    expect(() => limiter.check('user-2', 'chat:send')).not.toThrow();

    limiter.destroy();
  });

  it('resets the bucket after the window expires and cleans expired buckets', () => {
    jest.useFakeTimers();
    const limiter = new WsRateLimiter(1, 1_000);

    limiter.check('user-1', 'match:request');
    expect(() => limiter.check('user-1', 'match:request')).toThrow(WsException);

    jest.advanceTimersByTime(1_001);
    expect(() => limiter.check('user-1', 'match:request')).not.toThrow();

    // trigger scheduled cleanup at windowMs * 2
    jest.advanceTimersByTime(2_000);
    limiter.destroy();
  });
});
