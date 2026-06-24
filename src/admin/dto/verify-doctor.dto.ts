import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyDoctorDto {
  @ApiProperty({ description: 'Whether to approve the doctor.' })
  @IsBoolean()
  approved: boolean;

  @ApiPropertyOptional({ description: 'Rejection reason (required if approved=false).' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
