import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import appGeneralConfigs from './configs/general';
import authConfigs from './configs/auth';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      load: [
        appGeneralConfigs,
        authConfigs,
      ],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
