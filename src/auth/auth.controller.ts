import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UserLoginDto } from './dto/login.dto';
import { RegisterationDto } from './dto/register.dto';
import { AuthenticatedUserDto } from './dto/responses/auth-responses.dto';
import { ApiStandardOkResponse } from 'src/common/decorators/api-standard-ok-response.decorator';
import { FastifyReply } from 'fastify';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ description: 'Used for logging in the user' })
  @ApiStandardOkResponse(AuthenticatedUserDto)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async authenticate(
    @Body() authData: UserLoginDto,
    @Res() reply: FastifyReply,
  ) {
    const result = await this.authService.verifyAndLogin(authData, reply);
    return reply.send({
      contents: result,
      message: 'Success',
      status: 200,
    });
  }

  @ApiOperation({
    description: 'Register new users',
  })
  @ApiStandardOkResponse(AuthenticatedUserDto)
  @HttpCode(HttpStatus.CREATED)
  @Post('register')
  async register(@Body() RegisterationDto: RegisterationDto) {
    return this.authService.register(RegisterationDto);
  }

  @ApiOperation({ description: 'Logout and clear session' })
  @ApiStandardOkResponse('void')
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Res() reply: FastifyReply) {
    await this.authService.logout(reply);
    return reply.send({
      contents: { success: true },
      message: 'Success',
      status: 200,
    });
  }
}
