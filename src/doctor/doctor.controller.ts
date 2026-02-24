import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { DoctorService } from './doctor.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DocumentTypeEnum, User, UserRolesEnum } from '@prisma/client';
import { IntroduceDoctorDto } from './dto/introduce-doctor.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { DoctorFilterDto } from './dto/doctor-filter.dto';
import { ReviewService } from '../review/review.service';
import { FastifyRequest } from 'fastify';

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
    description: 'Upload a document for doctor verification (medical license, board cert, ID, etc.).',
  })
  @ApiConsumes('multipart/form-data')
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR)
  @Post('documents')
  async uploadDocument(
    @CurrentUser() user: User,
    @Req() req: FastifyRequest,
  ) {
    const data = await req.file();
    if (!data) {
      throw new BadRequestException('No file provided.');
    }

    // Extract type from form field or default to OTHER
    const typeField = (data.fields?.type as any)?.value;
    const docType: DocumentTypeEnum =
      typeField && Object.values(DocumentTypeEnum).includes(typeField)
        ? typeField
        : DocumentTypeEnum.OTHER;

    return this.doctorService.uploadDocument(user, data, docType);
  }

  @ApiOperation({
    description: 'Get all documents for the authenticated doctor.',
  })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.DOCTOR)
  @Get('documents')
  async getDocuments(@CurrentUser() user: User) {
    return this.doctorService.getDocuments(user);
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
