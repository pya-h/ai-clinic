import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteConsultationDto {
  @ApiPropertyOptional({ description: 'Doctor notes about the consultation.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Summary of the consultation outcome.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  summary?: string;

  @ApiPropertyOptional({
    description: 'Whether a follow-up consultation is needed.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  followUpNeeded?: boolean;
}
