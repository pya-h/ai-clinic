import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { User, UserRolesEnum } from '@prisma/client';
import { FastifyRequest } from 'fastify';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({
    description: 'Get the current user data.',
  })
  @UseGuards(CookieAuthGuard)
  @Get()
  getMe(@CurrentUser() user: User) {
    return user;
  }

  @ApiOperation({
    description: 'Get users (admin only)',
  })
  @UseGuards(CookieAuthGuard, AdminGuard)
  @Get('all')
  getUsers() {
    return this.userService.getUsers();
  }

  @ApiOperation({
    description: 'Update/Modify user profile data.',
  })
  @UseGuards(CookieAuthGuard)
  @Patch('profile')
  async updateUserData(
    @CurrentUser() user: User,
    @Body() updateUserData: UpdateUserDto,
    @Req() req: FastifyRequest,
  ) {
    const result = await this.userService.updateUser(user, updateUserData);
    const freshUser = await this.userService.getById(user.id);
    if (freshUser) {
      (req as any).session.set('user', freshUser);
    }
    return result;
  }

  @ApiOperation({
    description: 'Change user password. Requires current password verification.',
  })
  @UseGuards(CookieAuthGuard)
  @Patch('change-password')
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(user, dto);
  }

  @ApiOperation({
    description: 'Upload and set user avatar.',
  })
  @ApiConsumes('multipart/form-data')
  @UseGuards(CookieAuthGuard)
  @Post('avatar')
  async uploadAvatar(
    @CurrentUser() user: User,
    @Req() req: FastifyRequest,
  ) {
    const file = await req.file();
    if (!file) {
      throw new BadRequestException('No file provided.');
    }
    return this.userService.uploadAvatar(user, file);
  }

  @ApiOperation({
    description: 'Search users by name or email. Doctors can use this to find nurses to assign.',
  })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR)
  @Get('search')
  async searchUsers(@Query('q') query: string) {
    if (!query || query.trim().length < 2) {
      return [];
    }
    return this.userService.searchUsers(query.trim(), [UserRolesEnum.DOCTOR]);
  }

  @ApiOperation({
    description: 'Get the current user data.',
  })
  @UseGuards(CookieAuthGuard)
  @Get(':id')
  async getUser(
    @CurrentUser() currentUser: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (id === currentUser.id) return currentUser;

    if (!currentUser.isAdmin && !currentUser.isSuperAdmin) {
      const user = await this.userService.getPublicProfile(id);
      if (!user) throw new NotFoundException('User Not Found!');
      return user;
    }

    const user = await this.userService.getById(id);
    if (!user) throw new NotFoundException('User Not Found!');
    return user;
  }
}
