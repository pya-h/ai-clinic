import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRolesEnum } from '@prisma/client';
import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

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

  @ApiPropertyOptional({ description: 'Filter by banned status.' })
  @IsOptional()
  @IsBooleanString()
  isBanned?: string;

  @ApiPropertyOptional({ description: 'Search by name or email (case-insensitive).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Skip N items.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ description: 'Take N items.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
