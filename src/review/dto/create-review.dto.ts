import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ description: 'The DoctorProfile ID (autoincrement Int) to review.' })
  @IsNotEmpty()
  @IsInt()
  doctorId: number;

  @ApiProperty({ description: 'Rating from 1 to 5.', minimum: 1, maximum: 5 })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ description: 'Review title.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Review body / overview text.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  overview?: string;
}
