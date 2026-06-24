import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class FastifyThrottlerGuard extends ThrottlerGuard {
  getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(req.ips?.length ? req.ips[0] : req.ip);
  }
}
