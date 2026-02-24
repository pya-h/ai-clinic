import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from '../user/user.module';
import { ConfigModule } from '@nestjs/config';
import { CookieAuthGuard } from './guards/cookie-auth.guard';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [
    UserModule,
    ConfigModule,
    UtilsModule,
  ],
  providers: [AuthService, CookieAuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
