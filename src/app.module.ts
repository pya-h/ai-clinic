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
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { CacheModule } from './cache/cache.module';
import { ScheduleModule } from '@nestjs/schedule';
import { DoctorModule } from './doctor/doctor.module';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      load: [appGeneralConfigs, authConfigs, aiConfigs],
    }),
    CacheModule,
    UtilsModule,
    AiAgentsModule,
    ApiModule,
    AuthModule,
    UserModule,
    CacheModule,
    ScheduleModule.forRoot(),
    DoctorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
