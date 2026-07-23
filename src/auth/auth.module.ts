import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from '../user/user.module';
import { ConfigModule } from '@nestjs/config';
import { CookieAuthGuard } from './guards/cookie-auth.guard';
import { UtilsModule } from '../utils/utils.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    UserModule,
    ConfigModule,
    UtilsModule,
    PrismaModule,
  ],
  providers: [AuthService, CookieAuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
