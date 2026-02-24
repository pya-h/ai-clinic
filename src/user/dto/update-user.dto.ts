import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  isPrivate?: boolean;

  @ApiPropertyOptional({
    description: 'User avatar',
    example: 'https://example.com/image.png',
    type: 'string',
  })
  @IsOptional()
  @IsUrl()
  avatar?: string;
}
