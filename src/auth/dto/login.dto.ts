import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UserLoginDto {
  @ApiProperty({
    description: 'User email',
    example: 'example@example.com',
    type: 'string',
  })
  @IsNotEmpty({ message: 'Email field is required!' })
  @IsEmail({}, { message: 'Email field is not a valid email address!' })
  @MaxLength(255)
  @Transform(({ value }) => value?.toLowerCase())
  email: string;

  @ApiProperty({
    description: 'User password',
    example: '1NormalPass',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password field is required!' })
  @MaxLength(128)
  password: string;
}
