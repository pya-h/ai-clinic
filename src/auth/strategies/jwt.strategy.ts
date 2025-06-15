import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtTokenPayloadDto } from '../dto/jwt-token-payload.dto';
import { UserService } from '../../user/user.service';

@Injectable()
export class JwtAuthStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly userService: UserService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('auth.jwtSecret'),
      issuer: configService.get<string>('auth.jwtIssuer'),
    });
  }

  async validate({ sub, email }: JwtTokenPayloadDto) {
    const user = await this.userService.getById(+sub);

    if (!user || user.email !== email)
      throw new UnauthorizedException('Invalid token provided.');

    return user;
  }
}
