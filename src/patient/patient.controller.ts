import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PatientService } from './patient.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User, UserRolesEnum } from '@prisma/client';
import { CreatePatientProfileDto } from './dto/create-patient-profile.dto';
import { UpdatePatientProfileDto } from './dto/update-patient-profile.dto';

@ApiTags('Patient')
@Controller('patient')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @ApiOperation({
    description: 'Create a patient profile for the current user.',
  })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @HttpCode(HttpStatus.CREATED)
  @Post('profile')
  async createProfile(
    @CurrentUser() user: User,
    @Body() dto: CreatePatientProfileDto,
  ) {
    return this.patientService.createProfile(user, dto);
  }

  @ApiOperation({
    description: 'Update the current patient profile.',
  })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdatePatientProfileDto,
  ) {
    return this.patientService.updateProfile(user, dto);
  }

  @ApiOperation({
    description: 'Get the current patient profile.',
  })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @Get('profile')
  async getProfile(@CurrentUser() user: User) {
    return this.patientService.getProfile(user.id);
  }
}
