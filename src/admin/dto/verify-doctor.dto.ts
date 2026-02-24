import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class VerifyDoctorDto {
  @ApiProperty({ description: 'Whether to approve the doctor.' })
  @IsBoolean()
  approved: boolean;

  @ApiPropertyOptional({ description: 'Rejection reason (required if approved=false).' })
  @IsOptional()
  @IsString()
  reason?: string;
}
