import { Module, forwardRef } from '@nestjs/common';
import { SoapService } from './soap.service';
import { SoapController } from './soap.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { NurseModule } from '../nurse/nurse.module';

@Module({
  imports: [PrismaModule, forwardRef(() => NotificationModule), NurseModule],
  providers: [SoapService],
  controllers: [SoapController],
  exports: [SoapService],
})
export class SoapModule {}
