import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisitMethodsEnum, VisitTypesEnum } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class DoctorDecisionDto {
  @ApiProperty({
    description:
      'The consultation visit type or direct diagnosis decided by the doctor.',
    enum: VisitTypesEnum,
  })
  @IsNotEmpty()
  @IsEnum(VisitTypesEnum)
  doctorDecision: VisitTypesEnum;

  @ApiPropertyOptional({
    description:
      'The visit method for the consultation (required unless doctorDecision is DIRECT_DIAGNOSIS).',
    enum: VisitMethodsEnum,
  })
  @IsOptional()
  @IsEnum(VisitMethodsEnum)
  visitMethod?: VisitMethodsEnum;

  @ApiPropertyOptional({
    description: 'Final diagnosis when concluding with DIRECT_DIAGNOSIS.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  diagnosis?: string;

  @ApiPropertyOptional({
    description:
      'Recommendations and suggestions when concluding with DIRECT_DIAGNOSIS.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  suggestions?: string;

  @ApiPropertyOptional({
    description: 'Optional clinical notes from the doctor.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Whether a follow-up is needed (used with DIRECT_DIAGNOSIS).',
  })
  @IsOptional()
  @IsBoolean()
  followUpNeeded?: boolean;
}
