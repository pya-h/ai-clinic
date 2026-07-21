import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User, UserRolesEnum } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RegistrationDto } from '../auth/dto/register.dto';
import { UtilsService } from '../utils/utils.service';
import { DefaultArgs } from '@prisma/client/runtime/library';
import { FileUploadService } from '../file-upload/file-upload.service';
import { MultipartFile } from '@fastify/multipart';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  getById(id: string, select?: Prisma.UserSelect<DefaultArgs>) {
    if (select) {
      return this.prisma.user.findUnique({ where: { id }, select });
    }
    return this.prisma.user.findUnique({ where: { id }, omit: { password: true } });
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

  async createUser(userData: RegistrationDto) {
    if (await this.emailExists(userData.email)) {
      throw new ConflictException('Email is unavailable!');
    }
    if (userData.role !== undefined && !this.utilsService.isEnumElement(UserRolesEnum, userData.role)) {
      throw new BadRequestException('Invalid role!');
    }

    const hashedPassword = await this.utilsService.getHash(userData.password);

    try {
      const { password: _, ...user } = await this.prisma.user.create({
        data: {
          firstname: userData.firstname,
          lastname: userData.lastname,
          email: userData.email,
          role: userData.role || UserRolesEnum.PATIENT,
          isAdmin: false,
          password: hashedPassword,
          isPrivate: userData.isPrivate || false,
          avatar: userData.avatar || null,
        },
      });

      return user;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Email is unavailable!');
      }
      throw error;
    }
  }

  async updateUser(user: User, updateUserData: UpdateUserDto) {
    if (!Object.keys(updateUserData)?.length)
      throw new BadRequestException(
        'Provide some new data to continue modifying user data.',
      );
    if (updateUserData.email) {
      const existingByEmail = await this.getBy(
        { email: updateUserData.email },
        { select: { id: true } },
      );
      if (existingByEmail && existingByEmail.id !== user.id) {
        throw new ConflictException('This email is used before.');
      }
    }

    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...updateUserData,
      },
      select: this.safeUserSelect(),
    });
  }

  async changePassword(user: User, dto: ChangePasswordDto) {
    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { password: true },
    });
    if (!fullUser) {
      throw new BadRequestException('User not found.');
    }

    const isCurrentValid = await this.utilsService.compareHash(
      dto.currentPassword,
      fullUser.password,
    );
    if (!isCurrentValid) {
      throw new BadRequestException('Current password is incorrect.');
    }

    const isSamePassword = await this.utilsService.compareHash(
      dto.newPassword,
      fullUser.password,
    );
    if (isSamePassword) {
      throw new BadRequestException(
        'New password must be different from the current password.',
      );
    }

    const hashedPassword = await this.utilsService.getHash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return { message: 'Password changed successfully.' };
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

  /**
   * Upload and set user avatar.
   */
  async uploadAvatar(user: User, file: MultipartFile) {
    const uploaded = await this.fileUploadService.uploadFile(file, 'avatars');

    return this.prisma.user.update({
      where: { id: user.id },
      data: { avatar: uploaded.url },
      select: { id: true, avatar: true },
    });
  }

  getPublicProfile(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstname: true,
        lastname: true,
        role: true,
        avatar: true,
        isPrivate: true,
      },
    });
  }

  private safeUserSelect() {
    return {
      id: true,
      email: true,
      firstname: true,
      lastname: true,
      role: true,
      isAdmin: true,
      isSuperAdmin: true,
      isPrivate: true,
      isActive: true,
      avatar: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }
}
