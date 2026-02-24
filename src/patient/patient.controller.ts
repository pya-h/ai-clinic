import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
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
import { ConsultationService } from '../consultation/consultation.service';
import { ConsultationFilterDto } from '../consultation/dto/consultation-filter.dto';
import { SoapService } from '../soap/soap.service';
import { PaginationOptionsDto } from '../common/dtos/pagination-options.dto';

@ApiTags('Patient')
@Controller('patient')
export class PatientController {
  constructor(
    private readonly patientService: PatientService,
    private readonly consultationService: ConsultationService,
    private readonly soapService: SoapService,
  ) {}

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

  // ──────────────── B-29: Patient Consultations & SOAPs ────────────────

  @ApiOperation({
    description: 'List consultations for the current patient (paginated, filterable).',
  })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @Get('consultations')
  async getMyConsultations(
    @CurrentUser() user: User,
    @Query() filters: ConsultationFilterDto,
  ) {
    return this.consultationService.list(user, filters);
  }

  @ApiOperation({
    description: 'List SOAP notes for the current patient (paginated).',
  })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @Get('soaps')
  async getMySoaps(
    @CurrentUser() user: User,
    @Query() pagination: PaginationOptionsDto,
  ) {
    return this.soapService.getByUser(user.id, pagination);
  }
}
