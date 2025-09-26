import { BadRequestException, Injectable } from '@nestjs/common';
import { UserLoginDto } from './dto/login.dto';
import { UserService } from '../user/user.service';
import { RegisterationDto } from './dto/register.dto';
import { UtilsService } from 'src/utils/utils.service';
import { FastifyReply } from 'fastify';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly utilsService: UtilsService,
  ) {}

  async verifyAndLogin({ email, password }: UserLoginDto, reply: FastifyReply) {
    const user = await this.userService.getBy({ email });
    if (
      !user ||
      !(await this.utilsService.compareHash(password, user.password))
    ) {
      throw new BadRequestException('Invalid email or password!');
    }

    delete user.password;
    (reply as any).request.session.set('user', user);
    return user;
  }

  async register(data: RegisterationDto) {
    const user = await this.userService.createUser(data);
    delete user.password;
    return user;
  }

  async logout(reply: FastifyReply) {
    await (reply as any).request.session.delete();
  }
}
