import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReviewService } from './review.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User, UserRolesEnum } from '@prisma/client';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { PaginationOptionsDto } from '../common/dtos/pagination-options.dto';

@ApiTags('Review')
@Controller('review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @ApiOperation({ description: 'Create a review for a doctor (patient only).' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async create(@CurrentUser() user: User, @Body() dto: CreateReviewDto) {
    return this.reviewService.create(user, dto);
  }

  @ApiOperation({ description: 'Update own review.' })
  @UseGuards(CookieAuthGuard, RolesGuard)
  @Roles(UserRolesEnum.PATIENT)
  @Patch(':id')
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviewService.update(user, id, dto);
  }

  @ApiOperation({ description: 'Delete own review (or admin can delete any).' })
  @UseGuards(CookieAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async delete(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.reviewService.delete(id, user);
  }

  @ApiOperation({ description: 'List reviews for a doctor (public, paginated).' })
  @Get('doctor/:doctorId')
  async listByDoctor(
    @Param('doctorId', ParseIntPipe) doctorId: number,
    @Query() pagination: PaginationOptionsDto,
  ) {
    return this.reviewService.listByDoctor(doctorId, pagination);
  }

  @ApiOperation({ description: 'Get aggregate rating for a doctor (public).' })
  @Get('doctor/:doctorId/rating')
  async getAggregateRating(
    @Param('doctorId', ParseIntPipe) doctorId: number,
  ) {
    return this.reviewService.getAggregateRating(doctorId);
  }
}
