import { Module } from '@nestjs/common';
import { BotpressService } from './botpress.service';
import { AiAgentsController } from './ai-agents.controller';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [BotpressService],
  exports: [BotpressService],
  controllers: [AiAgentsController],
})
export class AiAgentsModule {}
