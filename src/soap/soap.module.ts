import { Module } from '@nestjs/common';
import { SoapService } from './soap.service';
import { SoapController } from './soap.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SoapService],
  controllers: [SoapController],
  exports: [SoapService],
})
export class SoapModule {}
