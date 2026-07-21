import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class BanUserDto {
  @ApiProperty({ description: 'Reason for banning the user.' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  reason: string;
}
