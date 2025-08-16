import { Module } from '@nestjs/common';
import { BotpressService } from './botpress.service';
import { AiAgentsController } from './ai-agents.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [BotpressService],
  exports: [BotpressService],
  controllers: [AiAgentsController],
})
export class AiAgentsModule {}
