import { Module, forwardRef } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, CacheModule, forwardRef(() => NotificationModule)],
  providers: [ReviewService],
  controllers: [ReviewController],
  exports: [ReviewService],
})
export class ReviewModule {}
