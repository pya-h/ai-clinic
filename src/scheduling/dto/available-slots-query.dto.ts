import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsNumberString, Validate, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

@ValidatorConstraint({ name: 'dateRangeLimit', async: false })
class DateRangeLimitConstraint implements ValidatorConstraintInterface {
  validate(_value: any, args: ValidationArguments): boolean {
    const obj = args.object as AvailableSlotsQueryDto;
    if (!obj.start || !obj.end) return true;
    const start = new Date(obj.start);
    const end = new Date(obj.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return true;
    if (end < start) return false;
    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= 31;
  }

  defaultMessage(): string {
    return 'Date range must not exceed 31 days and end must not be before start';
  }
}

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
  @Validate(DateRangeLimitConstraint)
  end: string;

  @ApiPropertyOptional({
    description: 'Preferred slot duration in minutes. Filters by doctor slot durations.',
  })
  @IsOptional()
  @IsNumberString()
  duration?: string;
}
