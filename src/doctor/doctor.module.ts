import { Module } from '@nestjs/common';
import { DoctorService } from './doctor.service';
import { DoctorController } from './doctor.controller';

@Module({
  providers: [DoctorService],
  controllers: [DoctorController]
})
export class DoctorModule {}
