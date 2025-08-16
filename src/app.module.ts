import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { UtilsModule } from './utils/utils.module';
import { AiAgentsModule } from './ai-agents/ai-agents.module';
import { ApiModule } from './api/api.module';
import appGeneralConfigs from './configs/general';
import authConfigs from './configs/auth';
import aiConfigs from './configs/ai';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      load: [appGeneralConfigs, authConfigs, aiConfigs],
    }),
    // ChatModule,
    UtilsModule,
    AiAgentsModule,
    ApiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
