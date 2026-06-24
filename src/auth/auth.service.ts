import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserLoginDto } from './dto/login.dto';
import { UserService } from '../user/user.service';
import { RegistrationDto } from './dto/register.dto';
import { UtilsService } from '../utils/utils.service';
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

  async register(data: RegistrationDto, reply: FastifyReply) {
    const user = await this.userService.createUser(data);
    (reply as any).request.session.set('user', user);
    return user;
  }

  async logout(reply: FastifyReply) {
    await (reply as any).request.session.delete();
  }

  /**
   * Re-fetches the user from DB and re-sets the session data.
   * Call after profile updates to keep session in sync.
   */
  async refreshSession(session: any, userId: string) {
    const user = await this.userService.getById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    delete user.password;
    session.set('user', user);
    return user;
  }
}
