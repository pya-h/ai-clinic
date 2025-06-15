import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class JwtTokenPayloadDto {
  @ApiProperty({
    description: 'Id of the user as payload subject',
    required: true,
  })
  @IsNotEmpty()
  @IsNumber()
  sub: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Jwt expiry related data.' })
  @IsNumber()
  iat: number;

  @ApiProperty({ description: 'Jwt expiry related data.' })
  @IsNumber()
  exp: number;
}
