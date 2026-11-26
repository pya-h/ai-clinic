import { Module, forwardRef } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { SchedulingController } from './scheduling.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendlyModule } from '../calendly/calendly.module';
import { NurseModule } from '../nurse/nurse.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    PrismaModule,
    CalendlyModule,
    NurseModule,
    forwardRef(() => NotificationModule),
  ],
  providers: [SchedulingService],
  controllers: [SchedulingController],
  exports: [SchedulingService],
})
export class SchedulingModule {}
