import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { DoctorService } from './doctor.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { User, UserRolesEnum } from '@prisma/client';
import { IntroduceDoctorDto } from './dto/introduce-doctor.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { DoctorFilterDto } from './dto/doctor-filter.dto';
import { ReviewService } from '../review/review.service';

@ApiTags('Doctor')
@Controller('doctor')
export class DoctorController {
  constructor(
    private readonly doctorService: DoctorService,
    private readonly reviewService: ReviewService,
  ) {}

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

  @ApiOperation({
    description: 'Update the current doctor profile.',
  })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR)
  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateDoctorProfileDto,
  ) {
    return this.doctorService.updateProfile(user, dto);
  }

  @ApiOperation({
    description: 'List verified doctors with optional filters. Public endpoint.',
  })
  @Get()
  async findAll(@Query() filters: DoctorFilterDto) {
    return this.doctorService.findAll(filters);
  }

  @ApiOperation({
    description: 'Get a single verified doctor profile by ID. Public endpoint.',
  })
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.doctorService.findOne(id);
  }

  @ApiOperation({
    description: 'Get aggregate rating for a doctor. Public endpoint.',
  })
  @Get(':id/rating')
  async getDoctorRating(@Param('id', ParseIntPipe) id: number) {
    return this.reviewService.getAggregateRating(id);
  }
}
