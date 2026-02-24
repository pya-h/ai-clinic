import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsNumberString } from 'class-validator';

export class AvailableSlotsQueryDto {
  @ApiProperty({
    description: 'Start date for slot search (YYYY-MM-DD or ISO string).',
    example: '2026-03-10',
  })
  @IsDateString()
  start: string;

  @ApiProperty({
    description: 'End date for slot search (YYYY-MM-DD or ISO string).',
    example: '2026-03-17',
  })
  @IsDateString()
  end: string;

  @ApiPropertyOptional({
    description: 'Preferred slot duration in minutes. Filters by doctor slot durations.',
  })
  @IsOptional()
  @IsNumberString()
  duration?: number;
}
