import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { UserLoginDto } from './dto/login.dto';
import { RegistrationDto } from './dto/register.dto';
import { AuthenticatedUserDto } from './dto/responses/auth-responses.dto';
import { ApiStandardOkResponse } from '../common/decorators/api-standard-ok-response.decorator';
import { FastifyReply } from 'fastify';
import { CookieAuthGuard } from './guards/cookie-auth.guard';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ description: 'Used for logging in the user' })
  @ApiStandardOkResponse(AuthenticatedUserDto)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async authenticate(
    @Body() authData: UserLoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.authService.verifyAndLogin(authData, reply);
  }

  @ApiOperation({
    description: 'Register new users',
  })
  @ApiStandardOkResponse(AuthenticatedUserDto)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @Post('register')
  async register(
    @Body() registrationDto: RegistrationDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.authService.register(registrationDto, reply);
  }

  @ApiOperation({ description: 'Logout and clear session' })
  @ApiStandardOkResponse('void')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CookieAuthGuard)
  @Post('logout')
  async logout(@Res({ passthrough: true }) reply: FastifyReply) {
    await this.authService.logout(reply);
    return { success: true };
  }
}
