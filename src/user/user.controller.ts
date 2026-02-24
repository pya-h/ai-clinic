import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UpdateUserDto } from './dto/update-user.dto';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { User } from '@prisma/client';
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
  ) {
    return this.userService.updateUser(user, updateUserData);
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

  // TODO: Implement the serialize user data INTERCEPTOR.
  @ApiOperation({
    description: 'Get the current user data.',
  })
  @UseGuards(CookieAuthGuard)
  @Get(':id')
  async getUser(
    @CurrentUser() currentUser: User,
    @Param('id') id: string,
  ) {
    // TODO: Implement the user data serialization for current user ad other users.
    // returns the full displayable data if the id === currentId, o.w. return the serialized data.

    if (id === currentUser.id) return currentUser;

    const user = await this.userService.getById(id);
    if (!user) throw new NotFoundException('User Not Found!');
    return user;
  }


}
