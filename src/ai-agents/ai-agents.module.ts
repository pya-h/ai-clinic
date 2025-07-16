import { Module } from '@nestjs/common';
import { BotpressService } from './botpress.service';
import { ApiModule } from 'src/api/api.module';

@Module({
  imports: [ApiModule],
  providers: [BotpressService],
  exports: [BotpressService],
})
export class AiAgentsModule {}
