import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReviewModule } from '../review/review.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [PrismaModule, ReviewModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
