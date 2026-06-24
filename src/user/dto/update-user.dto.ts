import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
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
  @IsString()
  @MinLength(3, { message: 'First name is too short!' })
  @MaxLength(100)
  firstname?: string;

  @ApiProperty({ description: 'The displaying lastname of the user' })
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Last name is too short!' })
  @MaxLength(100)
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
  @MaxLength(2048)
  avatar?: string;
}
