import { Module } from '@nestjs/common';
import { ConsultationService } from './consultation.service';
import { ConsultationController } from './consultation.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ConsultationService],
  controllers: [ConsultationController],
  exports: [ConsultationService],
})
export class ConsultationModule {}
