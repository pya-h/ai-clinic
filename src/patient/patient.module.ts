import { Module } from '@nestjs/common';
import { PatientService } from './patient.service';
import { PatientController } from './patient.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ConsultationModule } from '../consultation/consultation.module';
import { SoapModule } from '../soap/soap.module';

@Module({
  imports: [PrismaModule, ConsultationModule, SoapModule],
  providers: [PatientService],
  controllers: [PatientController],
  exports: [PatientService],
})
export class PatientModule {}
