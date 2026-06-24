import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsMilitaryTime,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateExceptionDto {
  @ApiProperty({
    description: 'The date of the exception (YYYY-MM-DD or ISO string).',
    example: '2026-03-15',
  })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({
    description:
      'Whether this date is fully blocked. Defaults to true (full day off).',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @ApiPropertyOptional({
    description:
      'Partial-day override start time (HH:mm). Only meaningful when isBlocked=false.',
    example: '09:00',
  })
  @IsOptional()
  @IsMilitaryTime()
  startTime?: string;

  @ApiPropertyOptional({
    description:
      'Partial-day override end time (HH:mm). Only meaningful when isBlocked=false.',
    example: '12:00',
  })
  @IsOptional()
  @IsMilitaryTime()
  endTime?: string;

  @ApiPropertyOptional({ description: 'Reason for the exception.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
