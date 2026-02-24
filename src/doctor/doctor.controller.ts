import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { DoctorService } from './doctor.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { User } from '@prisma/client';
import { IntroduceDoctorDto } from './dto/introduce-doctor.dto';

@ApiTags('Doctor')
@Controller('doctor')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @ApiOperation({
    description: 'Introduce user as a doctor and create a doctor profile.',
  })
  @UseGuards(CookieAuthGuard)
  @Post()
  async createDoctorProfile(
    @CurrentUser() user: User,
    @Body() introduceDoctorDto: IntroduceDoctorDto,
  ) {
    return this.doctorService.createDoctorProfile(user, introduceDoctorDto);
  }
}
