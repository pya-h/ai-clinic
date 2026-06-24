import { Module, forwardRef } from '@nestjs/common';
import { ConsultationService } from './consultation.service';
import { ConsultationController } from './consultation.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { NurseModule } from '../nurse/nurse.module';

@Module({
  imports: [PrismaModule, forwardRef(() => NotificationModule), NurseModule],
  providers: [ConsultationService],
  controllers: [ConsultationController],
  exports: [ConsultationService],
})
export class ConsultationModule {}
