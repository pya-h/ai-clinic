import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BasicUserRoles } from '../enums/basic-user-roles.enum';
import { IsEnumDetailed } from 'src/common/decorators/is-enum-detailed.decorator';

export class UpdateUserDto {
  @ApiProperty({ description: 'User email' })
  @IsOptional()
  @IsEmail({}, { message: 'Email field must be a valid email address!' })
  @MaxLength(256, {
    message: 'Email address can not be longer than 256 characters!',
  })
  email?: string;

  @ApiProperty({ description: 'The displaying name of the user' })
  @IsOptional()
  @MinLength(3, { message: 'First name is too short!' })
  firstname?: string;

  @ApiProperty({ description: 'The displaying lastname of the user' })
  @IsOptional()
  @MinLength(3, { message: 'Last name is too short!' })
  lastname?: string;

  @ApiPropertyOptional({
    description: 'Directly set user to be private.',
    example: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  isPrivate: boolean;

  @ApiPropertyOptional({
    description: 'User avatar',
    example: 'https://example.com/image.png',
    type: 'string',
  })
  @IsOptional()
  @IsUrl()
  avatar?: string;

  @ApiPropertyOptional({
    enum: BasicUserRoles,
    enumName: 'BasicUserRoles',
    example: BasicUserRoles.PATIENT,
    default: BasicUserRoles.PATIENT,
  })
  @IsOptional()
  @IsEnumDetailed(BasicUserRoles, 'role')
  role?: BasicUserRoles;

}
