import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRolesEnum } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

export class AdminUpdateUserDto {
  @ApiPropertyOptional({ description: 'First name.' })
  @IsOptional()
  @IsString()
  firstname?: string;

  @ApiPropertyOptional({ description: 'Last name.' })
  @IsOptional()
  @IsString()
  lastname?: string;

  @ApiPropertyOptional({ description: 'Email address.' })
  @IsOptional()
  @IsEmail()
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
