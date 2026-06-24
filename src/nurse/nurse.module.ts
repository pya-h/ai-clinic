import { Module } from '@nestjs/common';
import { NurseService } from './nurse.service';
import { NurseController } from './nurse.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [NurseService],
  controllers: [NurseController],
  exports: [NurseService],
})
export class NurseModule {}
