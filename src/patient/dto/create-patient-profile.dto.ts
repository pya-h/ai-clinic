import { ApiPropertyOptional } from '@nestjs/swagger';
import { VisitMethodsEnum } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsEnumDetailed } from '../../common/decorators/is-enum-detailed.decorator';

export class CreatePatientProfileDto {
  @ApiPropertyOptional({ description: 'Patient location / city' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @ApiPropertyOptional({
    description: 'Preferred visit methods',
    enum: VisitMethodsEnum,
    enumName: 'VisitMethodsEnum',
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnumDetailed(VisitMethodsEnum, 'Visit Method', true)
  visitMethods?: VisitMethodsEnum[];

  @ApiPropertyOptional({ description: 'Short bio about the patient' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({
    description: 'List of past medical conditions',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  medicalHistory?: string[];

  @ApiPropertyOptional({
    description: 'Known allergies',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  allergies?: string[];

  @ApiPropertyOptional({
    description: 'Current medications',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  medications?: string[];

  @ApiPropertyOptional({
    description: 'Past surgeries',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  surgeries?: string[];

  @ApiPropertyOptional({
    description: 'Relevant family medical history',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  familyHistory?: string[];
}
