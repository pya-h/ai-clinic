import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { UserLoginDto } from './dto/login.dto';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterationDto } from './dto/register.dto';
import { User } from '@prisma/client';
import { UtilsService } from 'src/utils/utils.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly utilsService: UtilsService,
  ) {}

  getJwtToken(user: User) {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });
  }

  async verifyAndLogin({ email, password }: UserLoginDto) {
    const user = await this.userService.getBy({ email });
    if (
      !user ||
      !(await this.utilsService.compareHash(password, user.password))
    ) {
      throw new BadRequestException('Invalid email or password!');
    }

    return { token: this.getJwtToken(user), id: user.id };
  }

  async register(data: RegisterationDto) {
    const user = await this.userService.createUser(data);
    return { token: this.getJwtToken(user), id: user.id };
  }
}
