import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateSlotDurationDto {
  @ApiProperty({
    description: 'Duration in minutes.',
    example: 30,
  })
  @IsInt()
  @Min(5)
  minutes: number;

  @ApiProperty({
    description: 'Price for this slot duration.',
    example: 50.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    description: 'Human-readable label, e.g. "Quick Check-Up".',
  })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({
    description: 'Whether this slot duration is active.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
