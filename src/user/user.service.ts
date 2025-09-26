import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User, UserRoles } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { RegisterationDto } from 'src/auth/dto/register.dto';
import { UtilsService } from 'src/utils/utils.service';
import { DefaultArgs } from '@prisma/client/runtime/library';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
  ) {}

  getById(id: string, select?: Prisma.UserSelect<DefaultArgs>) {
    return this.prisma.user.findUnique({
      where: { id },
      ...(select ? { select } : { select: { password: false } }),
    });
  }

  async userExists(userId: string): Promise<boolean> {
    return Boolean(await this.getById(userId));
  }

  async emailExists(email: string): Promise<boolean> {
    return Boolean(await this.getBy({ email }));
  }

  getBy(
    identifier: { id?: string; email?: string },
    {
      select = undefined,
    }: {
      select?: Prisma.UserSelect<DefaultArgs>;
      includePassword?: boolean;
    } = {},
  ) {
    const { id, email } = identifier;

    if (id != null)
      return this.prisma.user.findUnique({
        where: { id },
        ...(select ? { select } : {}),
      });

    if (email)
      return this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        ...(select ? { select } : {}),
      });

    throw new BadRequestException('Invalid arguments for finding a user');
  }

  async createUser(userData?: RegisterationDto) {
    if (await this.emailExists(userData.email)) {
      throw new ForbiddenException('Email is unavailable!');
    }
    if (!this.utilsService.isEnumElement(UserRoles, userData.role)) {
      throw new BadRequestException('Invalid role!');
    }

    const hashedPassword = await this.utilsService.getHash(userData.password);

    const user = await this.prisma.user.create({
      data: {
        firstname: userData.firstname,
        lastname: userData.lastname,
        email: userData.email,
        role: userData.role || UserRoles.PATIENT,
        isAdmin: false,
        password: hashedPassword,
        isPrivate: userData.isPrivate || false,
        avatar: userData.avatar || null,
      },
    });

    return user;
  }

  async updateUser(user: User, updateUserData: UpdateUserDto) {
    if (!Object.keys(updateUserData)?.length)
      throw new BadRequestException(
        'Provide some new data to continue modifying user data.',
      );
    if (
      updateUserData.email &&
      (await this.emailExists(updateUserData.email))
    ) {
      throw new ConflictException('This email is used before.');
    }
    // FIXME: further check required
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...updateUserData,
      },
    });
  }

  getUsers() {
    return this.prisma.user.findMany({
      where: { isAdmin: false },
      select: {
        avatar: true,
        createdAt: true,
        firstname: true,
        lastname: true,
        isPrivate: true,
        role: true,
      },
    });
  }
}
