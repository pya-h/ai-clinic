import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from '../user/user.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './guards/jwt.guard';
import { JwtAuthStrategy } from './strategies/jwt.strategy';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [
    UserModule,
    PassportModule,
    ConfigModule,
    UtilsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('auth.jwtSecret'),
        signOptions: {
          expiresIn: configService.getOrThrow<string>('auth.jwtExpiry'),
          issuer: configService.get<string>('auth.jwtIssuer'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtAuthStrategy, JwtAuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
