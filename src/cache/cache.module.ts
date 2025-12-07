import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { CacheModule as BaseCacheModule } from '@nestjs/cache-manager';

@Global()
@Module({
  imports: [BaseCacheModule.register()],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
