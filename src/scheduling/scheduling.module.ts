import { Module } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { SchedulingController } from './scheduling.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendlyModule } from '../calendly/calendly.module';

@Module({
  imports: [PrismaModule, CalendlyModule],
  providers: [SchedulingService],
  controllers: [SchedulingController],
  exports: [SchedulingService],
})
export class SchedulingModule {}
