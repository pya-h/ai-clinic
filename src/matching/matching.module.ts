import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { ReviewModule } from '../review/review.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { MatchingGateway } from './matching.gateway';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, ConfigModule, ReviewModule, SchedulingModule, forwardRef(() => NotificationModule)],
  controllers: [MatchingController],
  providers: [MatchingService, MatchingGateway],
  exports: [MatchingService, MatchingGateway],
})
export class MatchingModule {}
