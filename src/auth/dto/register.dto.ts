import {
  IsEmail,
  IsString,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsUrl,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnumDetailed } from '../../common/decorators/is-enum-detailed.decorator';
import { BasicUserRoles } from '../../user/enums/basic-user-roles.enum';

export class RegistrationDto {
  @ApiProperty({
    description: 'User email',
    example: 'example@example.com',
    type: 'string',
  })
  @IsNotEmpty({ message: 'Email field is required!' })
  @IsEmail({}, { message: 'Email field is not a valid email address!' })
  @Transform(({ value }) => value?.toLowerCase())
  email: string;

  @ApiProperty({
    description: 'User first name',
    example: 'John',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty({ message: 'First name field is required!' })
  firstname: string;

  @ApiProperty({
    description: 'User last name',
    example: 'Doe',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty({ message: 'Last name field is required!' })
  lastname: string;

  @ApiPropertyOptional({
    description: 'Directly set user to be private.',
    example: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

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
    description: 'User role. Only PATIENT and DOCTOR are allowed for self-registration.',
    example: BasicUserRoles.PATIENT,
    type: 'string',
    default: BasicUserRoles.PATIENT,
  })
  @IsOptional()
  @IsEnumDetailed(BasicUserRoles, 'role')
  role?: BasicUserRoles;

  @ApiProperty({
    description: 'User password',
    example: '1NormalPass',
    type: 'string',
  })
  @IsString()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}$/, {
    message:
      'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter and one digit',
  })
  @IsNotEmpty({ message: 'Password field is required!' })
  password: string;
}
