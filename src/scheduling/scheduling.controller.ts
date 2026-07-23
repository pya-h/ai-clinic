import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User, UserRolesEnum } from '@prisma/client';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SchedulingService } from './scheduling.service';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { CreateSlotDurationDto } from './dto/create-slot-duration.dto';
import { CreateExceptionDto } from './dto/create-exception.dto';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import { AvailableSlotsQueryDto } from './dto/available-slots-query.dto';
import { AppointmentFilterDto } from './dto/appointment-filter.dto';

@ApiTags('Scheduling')
@Controller('scheduling')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  // ──────────────── Availability (Doctor + Nurse) ────────────────

  @ApiOperation({ description: 'Create a weekly availability slot. Nurses may pass ?doctorId= to target a specific doctor.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Post('availability')
  async setAvailability(
    @CurrentUser() user: User,
    @Body() dto: CreateAvailabilityDto,
    @Query('doctorId', new ParseIntPipe({ optional: true })) targetDoctorId?: number,
  ) {
    const doctorId = await this.schedulingService.resolveDoctorIdForSchedule(user, targetDoctorId);
    return this.schedulingService.setAvailability(doctorId, dto);
  }

  @ApiOperation({ description: 'Get own weekly availability. Nurses may pass ?doctorId= to target a specific doctor.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Get('availability')
  async getMyAvailability(
    @CurrentUser() user: User,
    @Query('doctorId', new ParseIntPipe({ optional: true })) targetDoctorId?: number,
  ) {
    const doctorId = await this.schedulingService.resolveDoctorIdForSchedule(user, targetDoctorId);
    return this.schedulingService.getAvailability(doctorId);
  }

  @ApiOperation({ description: 'Update an availability slot. Nurses may pass ?doctorId= to target a specific doctor.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Patch('availability/:id')
  async updateAvailability(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAvailabilityDto,
    @Query('doctorId', new ParseIntPipe({ optional: true })) targetDoctorId?: number,
  ) {
    const doctorId = await this.schedulingService.resolveDoctorIdForSchedule(user, targetDoctorId);
    return this.schedulingService.updateAvailability(id, doctorId, dto);
  }

  @ApiOperation({ description: 'Delete an availability slot. Nurses may pass ?doctorId= to target a specific doctor.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Delete('availability/:id')
  async deleteAvailability(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
    @Query('doctorId', new ParseIntPipe({ optional: true })) targetDoctorId?: number,
  ) {
    const doctorId = await this.schedulingService.resolveDoctorIdForSchedule(user, targetDoctorId);
    return this.schedulingService.deleteAvailability(id, doctorId);
  }

  // ──────────────── Slot Durations (Doctor + Nurse) ────────────────

  @ApiOperation({ description: 'Create a slot duration preset. Nurses may pass ?doctorId= to target a specific doctor.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Post('slot-durations')
  async setSlotDuration(
    @CurrentUser() user: User,
    @Body() dto: CreateSlotDurationDto,
    @Query('doctorId', new ParseIntPipe({ optional: true })) targetDoctorId?: number,
  ) {
    const doctorId = await this.schedulingService.resolveDoctorIdForSchedule(user, targetDoctorId);
    return this.schedulingService.setSlotDuration(doctorId, dto);
  }

  @ApiOperation({ description: 'Get own slot duration presets. Nurses may pass ?doctorId= to target a specific doctor.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Get('slot-durations')
  async getMySlotDurations(
    @CurrentUser() user: User,
    @Query('doctorId', new ParseIntPipe({ optional: true })) targetDoctorId?: number,
  ) {
    const doctorId = await this.schedulingService.resolveDoctorIdForSchedule(user, targetDoctorId);
    return this.schedulingService.getSlotDurations(doctorId);
  }

  // ──────────────── Exceptions (Doctor + Nurse) ────────────────

  @ApiOperation({ description: 'Add an availability exception (vacation/day off). Nurses may pass ?doctorId= to target a specific doctor.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Post('exceptions')
  async addException(
    @CurrentUser() user: User,
    @Body() dto: CreateExceptionDto,
    @Query('doctorId', new ParseIntPipe({ optional: true })) targetDoctorId?: number,
  ) {
    const doctorId = await this.schedulingService.resolveDoctorIdForSchedule(user, targetDoctorId);
    return this.schedulingService.addException(doctorId, dto);
  }

  @ApiOperation({ description: 'Get own availability exceptions. Nurses may pass ?doctorId= to target a specific doctor.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Get('exceptions')
  async getMyExceptions(
    @CurrentUser() user: User,
    @Query('doctorId', new ParseIntPipe({ optional: true })) targetDoctorId?: number,
  ) {
    const doctorId = await this.schedulingService.resolveDoctorIdForSchedule(user, targetDoctorId);
    return this.schedulingService.getExceptions(doctorId);
  }

  @ApiOperation({ description: 'Delete an availability exception. Nurses may pass ?doctorId= to target a specific doctor.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Delete('exceptions/:id')
  async deleteException(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
    @Query('doctorId', new ParseIntPipe({ optional: true })) targetDoctorId?: number,
  ) {
    const doctorId = await this.schedulingService.resolveDoctorIdForSchedule(user, targetDoctorId);
    return this.schedulingService.deleteException(id, doctorId);
  }

  // ──────────────── Public Endpoints ────────────────

  @ApiOperation({
    description:
      'Compute available time slots for a doctor in a date range. Public endpoint.',
  })
  @Get('doctor/:doctorId/slots')
  async getAvailableSlots(
    @Param('doctorId', ParseIntPipe) doctorId: number,
    @Query() query: AvailableSlotsQueryDto,
  ) {
    return this.schedulingService.getAvailableSlots(
      doctorId,
      new Date(query.start),
      new Date(query.end),
      query.duration ? +query.duration : undefined,
    );
  }

  @ApiOperation({
    description: "Get a doctor's active slot duration presets. Public endpoint.",
  })
  @Get('doctor/:doctorId/durations')
  async getDoctorDurations(
    @Param('doctorId', ParseIntPipe) doctorId: number,
  ) {
    return this.schedulingService.getSlotDurations(doctorId);
  }

  // ──────────────── Appointments (Authenticated) ────────────────

  @ApiOperation({ description: 'Book an appointment with a doctor.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @Post('book')
  async bookAppointment(
    @CurrentUser() user: User,
    @Body() dto: BookAppointmentDto,
  ) {
    return this.schedulingService.bookAppointment(user, dto);
  }

  @ApiOperation({
    description:
      'List own appointments (patient sees own, doctor sees assigned, admin sees all).',
  })
  @UseGuards(CookieAuthGuard)
  @Get('appointments')
  async getMyAppointments(
    @CurrentUser() user: User,
    @Query() filters: AppointmentFilterDto,
  ) {
    return this.schedulingService.getMyAppointments(user, filters);
  }

  @ApiOperation({ description: 'Get a single appointment by ID.' })
  @UseGuards(CookieAuthGuard)
  @Get('appointments/:id')
  async getAppointment(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.schedulingService.getAppointment(id, user);
  }

  @ApiOperation({ description: 'Cancel an appointment.' })
  @UseGuards(CookieAuthGuard)
  @Patch('appointments/:id/cancel')
  async cancelAppointment(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.schedulingService.cancelAppointment(id, user);
  }
}
