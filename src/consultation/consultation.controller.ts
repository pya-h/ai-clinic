import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConsultationService } from './consultation.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User, UserRolesEnum } from '@prisma/client';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { DoctorDecisionDto } from './dto/doctor-decision.dto';
import { CompleteConsultationDto } from './dto/complete-consultation.dto';
import { ConsultationFilterDto } from './dto/consultation-filter.dto';

@ApiTags('Consultation')
@Controller('consultation')
@UseGuards(CookieAuthGuard)
export class ConsultationController {
  constructor(private readonly consultationService: ConsultationService) {}

  @ApiOperation({ description: 'Create a new consultation (patient only).' })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateConsultationDto,
  ) {
    return this.consultationService.create(user, dto);
  }

  @ApiOperation({
    description:
      'List consultations. Patients see own, doctors see assigned, admins see all.',
  })
  @Get()
  async list(
    @CurrentUser() user: User,
    @Query() filters: ConsultationFilterDto,
  ) {
    return this.consultationService.list(user, filters);
  }

  @ApiOperation({ description: 'Get a specific consultation by ID.' })
  @Get(':id')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.consultationService.getById(id, user);
  }

  @ApiOperation({
    description:
      'Doctor decides on a consultation (sets mode and visit method).',
  })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.DOCTOR)
  @Patch(':id/decide')
  async doctorDecide(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: DoctorDecisionDto,
  ) {
    return this.consultationService.doctorDecide(id, user, dto);
  }

  @ApiOperation({ description: 'Doctor completes a consultation.' })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.DOCTOR)
  @Patch(':id/complete')
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: CompleteConsultationDto,
  ) {
    return this.consultationService.complete(id, user, dto);
  }

  @ApiOperation({
    description:
      'Advance consultation to pending payment (DOCTOR_DECIDED → PENDING_PAYMENT).',
  })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.PATIENT, UserRolesEnum.DOCTOR)
  @Patch(':id/advance-payment')
  async advanceToPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.consultationService.advanceToPayment(id, user);
  }

  @ApiOperation({
    description:
      'Confirm payment for a consultation (PENDING_PAYMENT → PAYMENT_CONFIRMED).',
  })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.PATIENT, UserRolesEnum.DOCTOR)
  @Patch(':id/confirm-payment')
  async confirmPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.consultationService.confirmPayment(id, user);
  }

  @ApiOperation({
    description:
      'Doctor starts the consultation (PAYMENT_CONFIRMED → IN_PROGRESS).',
  })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.DOCTOR)
  @Patch(':id/start')
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.consultationService.startConsultation(id, user);
  }

  @ApiOperation({
    description: 'Cancel a consultation (patient, doctor, or admin).',
  })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.PATIENT, UserRolesEnum.DOCTOR)
  @Patch(':id/cancel')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.consultationService.cancel(id, user);
  }
}
