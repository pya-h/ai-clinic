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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MatchingService } from './matching.service';
import { MatchingGateway } from './matching.gateway';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User, UserRolesEnum } from '@prisma/client';
import { CreateMatchRequestDto } from './dto/create-match-request.dto';

@ApiTags('Matching')
@Controller('matching')
@UseGuards(CookieAuthGuard)
export class MatchingController {
  constructor(
    private readonly matchingService: MatchingService,
    private readonly matchingGateway: MatchingGateway,
  ) {}

  @ApiOperation({ description: 'Create a match request (patient only). Optionally provide soapId for auto-specialty.' })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @HttpCode(HttpStatus.CREATED)
  @Post('request')
  async createMatchRequest(
    @CurrentUser() user: User,
    @Body() dto: CreateMatchRequestDto,
  ) {
    const { matchRequest, doctors } =
      await this.matchingService.createMatchRequest(
        user,
        dto.soapId,
        dto.specialty,
      );

    return {
      matchRequest: await this.matchingGateway.dispatchMatchRequest(matchRequest, doctors),
      doctors,
    };
  }

  @ApiOperation({ description: 'Get the status of a match request.' })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.PATIENT, UserRolesEnum.DOCTOR)
  @Get('status/:id')
  async getStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.matchingService.getStatus(id, user);
  }

  @ApiOperation({ description: 'Get active match request for current patient.' })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @Get('active')
  async getActive(@CurrentUser() user: User) {
    return this.matchingService.getActiveForPatient(user.id);
  }

  @ApiOperation({ description: 'Get pending match requests assigned to the current doctor.' })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.DOCTOR)
  @Get('pending')
  async getPending(@CurrentUser() user: User) {
    return this.matchingService.getPendingForDoctor(user);
  }

  @ApiOperation({ description: 'Cancel an active match request (patient or admin).' })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @Patch(':id/cancel')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    const matchRequest = await this.matchingService.cancelRequest(id, user);
    await this.matchingGateway.notifyMatchCancelled(matchRequest);
    return matchRequest;
  }

  @ApiOperation({ description: 'Transition a timed-out match to manual browse.' })
  @UseGuards(RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @Patch(':id/browse')
  async fallbackToBrowse(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.matchingService.fallbackToManualBrowse(id, user);
  }
}
