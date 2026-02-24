import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRolesEnum } from '@prisma/client';
import {
  IsBooleanString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';

export class AdminUserFilterDto {
  @ApiPropertyOptional({ description: 'Filter by user role.', enum: UserRolesEnum })
  @IsOptional()
  @IsEnum(UserRolesEnum)
  role?: UserRolesEnum;

  @ApiPropertyOptional({ description: 'Filter by active status.' })
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  @ApiPropertyOptional({ description: 'Filter by admin status.' })
  @IsOptional()
  @IsBooleanString()
  isAdmin?: string;

  @ApiPropertyOptional({ description: 'Search by name or email (case-insensitive).' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Skip N items.' })
  @IsOptional()
  @IsNumberString()
  skip?: number;

  @ApiPropertyOptional({ description: 'Take N items.' })
  @IsOptional()
  @IsNumberString()
  take?: number;
}
