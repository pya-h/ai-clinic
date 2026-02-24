import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsMilitaryTime,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class CreateAvailabilityDto {
  @ApiProperty({
    description: 'Day of week: 0 (Sunday) through 6 (Saturday).',
    minimum: 0,
    maximum: 6,
  })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({
    description: 'Start time in HH:mm format (24-hour).',
    example: '09:00',
  })
  @IsMilitaryTime()
  startTime: string;

  @ApiProperty({
    description: 'End time in HH:mm format (24-hour).',
    example: '17:00',
  })
  @IsMilitaryTime()
  endTime: string;

  @ApiPropertyOptional({
    description: 'Whether this availability slot is active.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
