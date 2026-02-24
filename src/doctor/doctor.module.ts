import { Module } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { DoctorController } from './doctor.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ReviewModule } from '../review/review.module';

@Module({
  imports: [PrismaModule, ReviewModule],
  providers: [DoctorService],
  controllers: [DoctorController],
  exports: [DoctorService],
})
export class DoctorModule {}
