import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { AdminUserFilterDto } from './dto/admin-user-filter.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { VerifyDoctorDto } from './dto/verify-doctor.dto';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(CookieAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /* ── B-55  User management ─────────────────────────────── */

  @ApiOperation({ description: 'List all users (paginated, filterable).' })
  @Get('users')
  async listUsers(@Query() filters: AdminUserFilterDto) {
    return this.adminService.listUsers(filters);
  }

  @ApiOperation({ description: 'Admin update a user.' })
  @Patch('users/:id')
  async updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
    @CurrentUser() currentUser: User,
  ) {
    return this.adminService.updateUser(id, dto, currentUser);
  }

  @ApiOperation({ description: 'Deactivate a user account.' })
  @Patch('users/:id/deactivate')
  async deactivateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: User,
  ) {
    return this.adminService.deactivateUser(id, currentUser);
  }

  /* ── B-56  Doctor verification ─────────────────────────── */

  @ApiOperation({ description: 'List doctors pending verification.' })
  @Get('doctors/pending')
  async listPendingDoctors() {
    return this.adminService.listPendingDoctors();
  }

  @ApiOperation({ description: 'Get documents for a doctor.' })
  @Get('doctors/:id/documents')
  async getDoctorDocuments(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.getDoctorDocuments(id);
  }

  @ApiOperation({ description: 'Verify or reject a doctor.' })
  @Patch('doctors/:id/verify')
  async verifyDoctor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VerifyDoctorDto,
    @CurrentUser() admin: User,
  ) {
    return this.adminService.verifyDoctor(id, dto, admin);
  }

  /* ── B-57  Promote / demote (Superadmin only) ──────────── */

  @ApiOperation({ description: 'Promote a user to admin.' })
  @UseGuards(SuperAdminGuard)
  @Patch('users/:id/promote')
  async promoteToAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.promoteToAdmin(id);
  }

  @ApiOperation({ description: 'Demote an admin to regular user.' })
  @UseGuards(SuperAdminGuard)
  @Patch('users/:id/demote')
  async demoteAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: User,
  ) {
    return this.adminService.demoteAdmin(id, currentUser);
  }

  /* ── B-59  Review moderation ───────────────────────────── */

  @ApiOperation({ description: 'Admin delete any review.' })
  @Delete('reviews/:id')
  async removeReview(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() admin: User,
  ) {
    return this.adminService.removeReview(id, admin);
  }

  /* ── B-58  Platform stats ──────────────────────────────── */

  @ApiOperation({ description: 'Get platform statistics.' })
  @Get('stats')
  async getPlatformStats() {
    return this.adminService.getPlatformStats();
  }
}
