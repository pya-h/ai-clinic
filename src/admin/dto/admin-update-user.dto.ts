import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRolesEnum } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AdminUpdateUserDto {
  @ApiPropertyOptional({ description: 'First name.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstname?: string;

  @ApiPropertyOptional({ description: 'Last name.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastname?: string;

  @ApiPropertyOptional({ description: 'Email address.' })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase())
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: 'User role.', enum: UserRolesEnum })
  @IsOptional()
  @IsEnum(UserRolesEnum)
  role?: UserRolesEnum;

  @ApiPropertyOptional({ description: 'Active status.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Private profile flag.' })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}
