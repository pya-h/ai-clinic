import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NurseService } from './nurse.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User, UserRolesEnum } from '@prisma/client';
import { AssignNurseDto } from './dto/assign-nurse.dto';
import { UpdatePermissionsDto } from './dto/update-permissions.dto';

@ApiTags('Nurse')
@Controller('nurse')
@UseGuards(CookieAuthGuard, RolesGuard)
export class NurseController {
  constructor(private readonly nurseService: NurseService) {}

  @ApiOperation({ description: 'Assign a nurse to the authenticated doctor.' })
  @Roles(UserRolesEnum.DOCTOR)
  @Post('assign')
  async assignNurse(
    @CurrentUser() user: User,
    @Body() dto: AssignNurseDto,
  ) {
    return this.nurseService.assignNurse(user, dto);
  }

  @ApiOperation({ description: 'Update permissions on a nurse assignment.' })
  @Roles(UserRolesEnum.DOCTOR)
  @Patch('assignment/:id/permissions')
  async updatePermissions(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePermissionsDto,
  ) {
    return this.nurseService.updatePermissions(user, id, dto);
  }

  @ApiOperation({ description: 'Deactivate a nurse assignment.' })
  @Roles(UserRolesEnum.DOCTOR)
  @Delete('assignment/:id')
  async removeAssignment(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.nurseService.removeAssignment(user, id);
  }

  @ApiOperation({ description: 'List nurse assignments for the current user (doctor sees their nurses, nurse sees their doctors).' })
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Get('assignments')
  async getMyAssignments(@CurrentUser() user: User) {
    return this.nurseService.getMyAssignments(user);
  }

  @ApiOperation({ description: 'Get a specific nurse assignment.' })
  @Roles(UserRolesEnum.DOCTOR, UserRolesEnum.NURSE)
  @Get('assignment/:id')
  async getAssignment(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.nurseService.getAssignment(user, id);
  }
}
