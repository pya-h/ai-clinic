import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from './chat/chat.module';
import { UtilsModule } from './utils/utils.module';
import appGeneralConfigs from './configs/general';
import authConfigs from './configs/auth';
import aiConfigs from './configs/ai';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      load: [appGeneralConfigs, authConfigs, aiConfigs],
    }),
    ChatModule,
    UtilsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
