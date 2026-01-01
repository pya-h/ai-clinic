import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { DoctorService } from './doctor.service';
import { CookieAuthGuard } from '../auth/guards/jwt.guard';
import { User } from '@prisma/client';
import { IntroduceDoctorDto } from './dto/introduce-doctor.dto';

@Controller('doctor')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}
  @ApiOperation({
    description: 'Introduce user as a doctor and create a doctor profile.',
  })
  @UseGuards(CookieAuthGuard)
  @Post()
  async updateUserData(
    @CurrentUser() user: User,
    @Body() updateUserData: IntroduceDoctorDto,
  ) {
    return this.userService.updateUser(user, updateUserData);
  }
}
