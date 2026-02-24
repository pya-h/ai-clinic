import { Module } from '@nestjs/common';
import { BotpressService } from './botpress.service';
import { AiAgentsController } from './ai-agents.controller';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { OpenAiAgentController } from './openai/openai.controller';
import { OpenAiService } from './openai/openai.service';
import { SoapModule } from '../soap/soap.module';

@Module({
  imports: [ConfigModule, PrismaModule, SoapModule],
  providers: [BotpressService, OpenAiService],
  exports: [],
  controllers: [AiAgentsController, OpenAiAgentController],
})
export class AiAgentsModule {}
