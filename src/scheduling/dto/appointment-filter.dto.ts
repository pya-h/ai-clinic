import { ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatusEnum } from '@prisma/client';
import { IsDateString, IsEnum, IsNumberString, IsOptional } from 'class-validator';

export class AppointmentFilterDto {
  @ApiPropertyOptional({
    description: 'Filter by appointment status.',
    enum: AppointmentStatusEnum,
  })
  @IsOptional()
  @IsEnum(AppointmentStatusEnum)
  status?: AppointmentStatusEnum;

  @ApiPropertyOptional({
    description: 'Filter appointments from this date onward.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Filter appointments up to this date.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Skip N items.' })
  @IsOptional()
  @IsNumberString()
  skip?: number;

  @ApiPropertyOptional({ description: 'Take N items.' })
  @IsOptional()
  @IsNumberString()
  take?: number;
}
