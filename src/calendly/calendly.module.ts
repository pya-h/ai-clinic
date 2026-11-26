import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';
import { NurseModule } from '../nurse/nurse.module';
import { CalendlyController } from './calendly.controller';
import { CalendlyService } from './calendly.service';

@Module({
  imports: [PrismaModule, ConfigModule, CacheModule, NurseModule],
  controllers: [CalendlyController],
  providers: [CalendlyService],
  exports: [CalendlyService],
})
export class CalendlyModule {}
