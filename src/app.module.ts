import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import notificationConfigs from './configs/notification';
import storageConfigs from './configs/storage';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { CacheModule } from './cache/cache.module';
import { ScheduleModule } from '@nestjs/schedule';
import { DoctorModule } from './doctor/doctor.module';
import { PatientModule } from './patient/patient.module';
import { SoapModule } from './soap/soap.module';
import { ReviewModule } from './review/review.module';
import { ConsultationModule } from './consultation/consultation.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      load: [appGeneralConfigs, authConfigs, aiConfigs, notificationConfigs, storageConfigs],
    }),
    CacheModule,
    UtilsModule,
    AiAgentsModule,
    ApiModule,
    AuthModule,
    UserModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 100 }],
    }),
    DoctorModule,
    PatientModule,
    SoapModule,
    ReviewModule,
    ConsultationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
