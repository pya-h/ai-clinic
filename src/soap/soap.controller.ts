import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SoapService } from './soap.service';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentUser } from '../user/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { PaginationOptionsDto } from '../common/dtos/pagination-options.dto';

@ApiTags('SOAP')
@Controller('soap')
@UseGuards(CookieAuthGuard)
export class SoapController {
  constructor(private readonly soapService: SoapService) {}

  @ApiOperation({
    description:
      'Get all SOAP notes for the current authenticated user (paginated).',
  })
  @Get()
  async getMySoaps(
    @CurrentUser() user: User,
    @Query() pagination: PaginationOptionsDto,
  ) {
    return this.soapService.getByUser(user.id, pagination);
  }

  @ApiOperation({
    description:
      'Get a single SOAP note by ID (ownership check — must be your own).',
  })
  @Get(':id')
  async getSoapById(@Param('id') id: string, @CurrentUser() user: User) {
    return this.soapService.getById(id, user.id, user.isAdmin);
  }
}
